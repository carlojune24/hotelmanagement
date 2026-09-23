import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import {
	RESERVATION_VIEWS,
	RESERVATIONS_PAGE_SIZE,
	VIEW_STATUSES,
	type ReservationListParams,
	type ReservationView
} from '$lib/reservation-views';
import { db } from './db/index';
import { getFolioDetail } from './folio';
import { lineBalances } from './order-balances';
import {
	bookings,
	bookingRooms,
	bookingStatusHistory,
	emailLog,
	guestMessages,
	hallBookings,
	hallBookingStatusHistory,
	orders,
	guests,
	payments,
	roomTypes,
	ratePlans,
	functionHalls,
	rooms,
	roomAssignments
} from './db/schema/index';

/** Confirmation-email attempts for an order, newest first. */
function orderEmails(orderId: string) {
	return db
		.select()
		.from(emailLog)
		.where(and(eq(emailLog.orderId, orderId), eq(emailLog.type, 'booking_confirmation')))
		.orderBy(desc(emailLog.createdAt));
}

export type ReservationKind = 'room' | 'hall';

/**
 * One row per booking line (a room stay or a hall reservation), not per order —
 * an order with both a room and a hall shows as two lines here, each linking
 * back to the same guest/order. Matches how the data is actually modeled
 * (`bookings`/`hallBookings` are separate tables under one `orders` row) rather
 * than inventing a merged synthetic status.
 */
export interface ReservationLine {
	kind: ReservationKind;
	id: string;
	orderId: string;
	/** First 8 of the order id, upper-case — the code staff and guests quote. */
	bookingCode: string;
	guestName: string;
	guestEmail: string;
	title: string;
	subtitle: string;
	/** Assigned room number(s), e.g. "101, 102"; null until a room is assigned (or for a hall). */
	roomNumbers: string | null;
	startDate: string;
	endDate: string | null;
	status: string;
	orderStatus: string;
	totalCentavos: number;
	/** What THIS room still owes (its charges minus what it has been paid). Zero for a settled
	 *  room or a line that isn't live. See `lineBalances`. */
	balanceCentavos: number;
	createdAt: Date;
	/** An open (unresolved) guest cancellation request against this specific line. */
	hasOpenCancellationRequest: boolean;
}

/**
 * One page of the staff Reservations list — room stays and hall events together, filtered by
 * tab (see `$lib/reservation-views`), type and search, ordered the way each tab is read, and
 * paged in the database (the list used to load every booking the hotel ever had). Also
 * returns each tab's count under the same type + search, for the tab badges.
 */
export async function listReservationPage(
	hotelId: string,
	params: ReservationListParams
): Promise<{ lines: ReservationLine[]; total: number; counts: Record<ReservationView, number> }> {
	const q = params.q.toLowerCase();
	// Escape LIKE's own wildcards so a search for "50%" or "a_b" matches literally.
	const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

	// Every room stay + hall event as one row shape.
	const linesCte = sql`
		with lines as (
			select 'room'::text as kind, b.id, b.order_id, g.full_name as guest_name, g.email as guest_email,
				rt.name as title, rp.name as subtitle, b.check_in::text as start_date, b.check_out::text as end_date,
				b.status::text as status, o.status::text as order_status, b.total_centavos, b.created_at,
				(select string_agg(r.room_number, ', ' order by r.room_number)
					from ${roomAssignments} ra join ${rooms} r on r.id = ra.room_id
					where ra.booking_room_id = br.id) as room_numbers
			from ${bookings} b
			join ${orders} o on o.id = b.order_id
			join ${guests} g on g.id = o.guest_id
			join ${bookingRooms} br on br.booking_id = b.id
			join ${roomTypes} rt on rt.id = br.room_type_id
			join ${ratePlans} rp on rp.id = br.rate_plan_id
			where b.hotel_id = ${hotelId}
			union all
			select 'hall'::text, h.id, h.order_id, g.full_name, g.email, fh.name, h.event_type,
				h.event_date::text, null, h.status::text, o.status::text, h.total_centavos, h.created_at, null
			from ${hallBookings} h
			join ${orders} o on o.id = h.order_id
			join ${guests} g on g.id = o.guest_id
			join ${functionHalls} fh on fh.id = h.function_hall_id
			where o.hotel_id = ${hotelId}
		),
		filtered as (
			select * from lines
			where (${params.type} = 'all' or kind = ${params.type})
			and (${q} = ''
				or lower(guest_name) like ${like}
				or lower(guest_email) like ${like}
				or lower(left(order_id::text, 8)) like ${like}
				or lower(coalesce(room_numbers, '')) like ${like})
		)`;

	const inView = (view: ReservationView) =>
		view === 'all'
			? sql`true`
			: sql`status in (${sql.join(
					VIEW_STATUSES[view].map((st) => sql`${st}`),
					sql`, `
				)})`;
	const orderBy: Record<ReservationView, ReturnType<typeof sql>> = {
		upcoming: sql`start_date asc, created_at asc`,
		'in-house': sql`end_date asc nulls last, start_date asc`,
		past: sql`coalesce(end_date, start_date) desc, created_at desc`,
		cancelled: sql`created_at desc`,
		all: sql`created_at desc`
	};

	const offset = (params.page - 1) * RESERVATIONS_PAGE_SIZE;
	type Row = {
		kind: ReservationKind;
		id: string;
		order_id: string;
		guest_name: string;
		guest_email: string;
		title: string;
		subtitle: string;
		start_date: string;
		end_date: string | null;
		status: string;
		order_status: string;
		total_centavos: string | number;
		created_at: string | Date;
		room_numbers: string | null;
	};
	const [rows, countRows] = await Promise.all([
		db.execute<Row>(sql`${linesCte}
			select * from filtered where ${inView(params.view)}
			order by ${orderBy[params.view]}
			limit ${RESERVATIONS_PAGE_SIZE} offset ${offset}`),
		db.execute<Record<string, string | number>>(sql`${linesCte}
			select count(*) as "all",
				${sql.join(
					(Object.keys(VIEW_STATUSES) as Exclude<ReservationView, 'all'>[]).map(
						(v) => sql`count(*) filter (where ${inView(v)}) as ${sql.identifier(v)}`
					),
					sql`, `
				)}
			from filtered`)
	]);

	const c = countRows[0] ?? {};
	const counts = Object.fromEntries(
		RESERVATION_VIEWS.map((v) => [v.key, Number(c[v.key] ?? 0)])
	) as Record<ReservationView, number>;

	// Balance owed + open cancellation requests — only for the rows on this page.
	const live = (r: Row) =>
		r.status === 'confirmed' || (r.kind === 'room' && r.status === 'checked_in');
	const balances = await lineBalances(
		hotelId,
		rows.filter(live).map((r) => r.order_id)
	);
	const ids = rows.map((r) => r.id);
	const openRequests = ids.length
		? await db
				.select({ bookingId: guestMessages.bookingId, hallBookingId: guestMessages.hallBookingId })
				.from(guestMessages)
				.where(
					and(
						eq(guestMessages.hotelId, hotelId),
						eq(guestMessages.kind, 'cancellation_request'),
						eq(guestMessages.status, 'open'),
						or(inArray(guestMessages.bookingId, ids), inArray(guestMessages.hallBookingId, ids))
					)
				)
		: [];
	const withRequest = new Set(
		openRequests.flatMap((r) => [r.bookingId, r.hallBookingId]).filter((v): v is string => !!v)
	);

	const lines: ReservationLine[] = rows.map((r) => ({
		kind: r.kind,
		id: r.id,
		orderId: r.order_id,
		bookingCode: r.order_id.slice(0, 8).toUpperCase(),
		guestName: r.guest_name,
		guestEmail: r.guest_email,
		title: r.title,
		subtitle: r.subtitle,
		roomNumbers: r.room_numbers,
		startDate: r.start_date,
		endDate: r.end_date,
		status: r.status,
		orderStatus: r.order_status,
		totalCentavos: Number(r.total_centavos),
		balanceCentavos: live(r) ? Math.max(0, balances.get(r.id) ?? 0) : 0,
		createdAt: new Date(r.created_at),
		hasOpenCancellationRequest: withRequest.has(r.id)
	}));

	return { lines, total: counts[params.view], counts };
}

export interface SiblingReservationLine {
	kind: ReservationKind;
	id: string;
	title: string;
	subtitle: string;
	status: string;
}

/**
 * Every other room/hall line on the same order — a multi-room-type walk-in (or
 * online order) settled in one payment still becomes one `bookings`/`hallBookings`
 * row *per line* (see `createWalkInBooking`'s doc comment), so a single order can
 * span several sibling reservation detail pages. Without this, opening one line
 * gives no indication the other room(s) staff selected together exist at all.
 */
async function siblingLines(
	orderId: string,
	excludeKind: ReservationKind,
	excludeId: string
): Promise<SiblingReservationLine[]> {
	const roomRows = await db
		.select({
			id: bookings.id,
			bookingRoomId: bookingRooms.id,
			roomTypeName: roomTypes.name,
			ratePlanName: ratePlans.name,
			status: bookings.status
		})
		.from(bookings)
		.innerJoin(bookingRooms, eq(bookingRooms.bookingId, bookings.id))
		.innerJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId))
		.innerJoin(ratePlans, eq(ratePlans.id, bookingRooms.ratePlanId))
		.where(eq(bookings.orderId, orderId));

	const bookingRoomIds = roomRows.map((r) => r.bookingRoomId);
	const roomNumberRows = bookingRoomIds.length
		? await db
				.select({ bookingRoomId: roomAssignments.bookingRoomId, roomNumber: rooms.roomNumber })
				.from(roomAssignments)
				.innerJoin(rooms, eq(rooms.id, roomAssignments.roomId))
				.where(inArray(roomAssignments.bookingRoomId, bookingRoomIds))
		: [];
	const roomNumbersByBookingRoom = new Map<string, string[]>();
	for (const r of roomNumberRows) {
		const list = roomNumbersByBookingRoom.get(r.bookingRoomId) ?? [];
		list.push(r.roomNumber);
		roomNumbersByBookingRoom.set(r.bookingRoomId, list);
	}

	const hallRows = await db
		.select({
			id: hallBookings.id,
			hallName: functionHalls.name,
			eventType: hallBookings.eventType,
			status: hallBookings.status
		})
		.from(hallBookings)
		.innerJoin(functionHalls, eq(functionHalls.id, hallBookings.functionHallId))
		.where(eq(hallBookings.orderId, orderId));

	const lines: SiblingReservationLine[] = [
		...roomRows.map((r) => {
			const roomNumbers = roomNumbersByBookingRoom.get(r.bookingRoomId) ?? [];
			return {
				kind: 'room' as const,
				id: r.id,
				title: roomNumbers.length ? `Room ${roomNumbers.join(', ')}` : r.roomTypeName,
				subtitle: roomNumbers.length ? r.roomTypeName : r.ratePlanName,
				status: r.status
			};
		}),
		...hallRows.map((h) => ({
			kind: 'hall' as const,
			id: h.id,
			title: h.hallName,
			subtitle: h.eventType,
			status: h.status
		}))
	];
	return lines.filter((l) => !(l.kind === excludeKind && l.id === excludeId));
}

/** Charges / paid / balance for a booking's folio, or `null` when no folio should exist yet —
 *  `getFolioDetail` creates the folio on first read, so a pending or cancelled booking (never
 *  settled at the desk) is skipped rather than given an empty one just for being viewed. */
async function folioSummary(
	hotelId: string,
	status: string,
	target: Parameters<typeof getFolioDetail>[1]
) {
	if (!['confirmed', 'checked_in', 'checked_out', 'completed'].includes(status)) return null;
	const f = await getFolioDetail(hotelId, target);
	return {
		/** This room's own charges. */
		chargesTotalCentavos: f.chargesTotalCentavos,
		/** THIS room's own paid amount and balance. */
		paidTotalCentavos: f.paidTotalCentavos,
		balanceCentavos: f.balanceCentavos,
		/** The whole booking, for context (the sum of its rooms). */
		orderBalanceCentavos: f.orderBalanceCentavos,
		orderChargesTotalCentavos: f.orderChargesTotalCentavos,
		orderLineCount: f.orderLineCount
	};
}

export async function getRoomBookingDetail(hotelId: string, bookingId: string) {
	const [row] = await db
		.select({
			booking: bookings,
			order: orders,
			guest: guests,
			roomType: roomTypes,
			ratePlan: ratePlans,
			bookingRoom: bookingRooms
		})
		.from(bookings)
		.innerJoin(orders, eq(orders.id, bookings.orderId))
		.innerJoin(guests, eq(guests.id, orders.guestId))
		.innerJoin(bookingRooms, eq(bookingRooms.bookingId, bookings.id))
		.innerJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId))
		.innerJoin(ratePlans, eq(ratePlans.id, bookingRooms.ratePlanId))
		.where(and(eq(bookings.id, bookingId), eq(bookings.hotelId, hotelId)))
		.limit(1);
	if (!row) return null;

	const [history, paymentRows, assignedRooms, confirmationEmails, siblings] = await Promise.all([
		db
			.select()
			.from(bookingStatusHistory)
			.where(eq(bookingStatusHistory.bookingId, bookingId))
			.orderBy(desc(bookingStatusHistory.createdAt)),
		db
			.select()
			.from(payments)
			.where(eq(payments.orderId, row.order.id))
			.orderBy(desc(payments.createdAt)),
		db
			.select({ roomNumber: rooms.roomNumber })
			.from(roomAssignments)
			.innerJoin(rooms, eq(rooms.id, roomAssignments.roomId))
			.where(eq(roomAssignments.bookingRoomId, row.bookingRoom.id)),
		orderEmails(row.order.id),
		siblingLines(row.order.id, 'room', bookingId)
	]);

	const folio = await folioSummary(hotelId, row.booking.status, { kind: 'room', bookingId });
	return {
		...row,
		history,
		payments: paymentRows,
		assignedRooms,
		confirmationEmails,
		siblings,
		folio
	};
}

export async function getHallBookingDetail(hotelId: string, hallBookingId: string) {
	const [row] = await db
		.select({
			hallBooking: hallBookings,
			order: orders,
			guest: guests,
			hall: functionHalls
		})
		.from(hallBookings)
		.innerJoin(orders, eq(orders.id, hallBookings.orderId))
		.innerJoin(guests, eq(guests.id, orders.guestId))
		.innerJoin(functionHalls, eq(functionHalls.id, hallBookings.functionHallId))
		.where(and(eq(hallBookings.id, hallBookingId), eq(orders.hotelId, hotelId)))
		.limit(1);
	if (!row) return null;

	const [history, paymentRows, confirmationEmails, siblings] = await Promise.all([
		db
			.select()
			.from(hallBookingStatusHistory)
			.where(eq(hallBookingStatusHistory.hallBookingId, hallBookingId))
			.orderBy(desc(hallBookingStatusHistory.createdAt)),
		db
			.select()
			.from(payments)
			.where(eq(payments.orderId, row.order.id))
			.orderBy(desc(payments.createdAt)),
		orderEmails(row.order.id),
		siblingLines(row.order.id, 'hall', hallBookingId)
	]);

	const folio = await folioSummary(hotelId, row.hallBooking.status, {
		kind: 'hall',
		hallBookingId
	});
	return { ...row, history, payments: paymentRows, confirmationEmails, siblings, folio };
}
