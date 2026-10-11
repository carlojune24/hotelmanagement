import { and, asc, eq, gte, inArray, isNull, lte, ne } from 'drizzle-orm';
import { db } from './db/index';
import {
	bookingRooms,
	bookings,
	functionHalls,
	guests,
	hallBookings,
	orders,
	payments,
	roomAssignments,
	roomTypes,
	rooms,
	securityDeposits
} from './db/schema/index';
import { loadOrderLedgers } from './folio';

export interface BookingTransactionRow {
	orderId: string;
	/** When the booking was made — the list is newest first by this. */
	createdAt: string;
	code: string;
	guestName: string;
	guestEmail: string;
	/** "Room D1, Room 101" / room type when no room is assigned yet / hall name. */
	roomLabel: string;
	/** Earliest arrival and latest departure across the booking's rooms/events. */
	checkIn: string;
	checkOut: string;
	lineCount: number;
	status: 'confirmed' | 'in_house' | 'checked_out' | 'cancelled';
	/** How many of the booking's rooms/events are cancelled (a partly cancelled booking keeps its live status). */
	cancelledCount: number;
	chargesCentavos: number;
	paidCentavos: number;
	balanceCentavos: number;
}

function summariseStatus(statuses: string[]): BookingTransactionRow['status'] {
	if (statuses.every((s) => s === 'cancelled' || s === 'no_show')) return 'cancelled';
	const live = statuses.filter((s) => s !== 'cancelled' && s !== 'no_show');
	if (live.some((s) => s === 'checked_in')) return 'in_house';
	if (live.every((s) => s === 'checked_out' || s === 'completed')) return 'checked_out';
	return 'confirmed';
}

/**
 * Every booking (order) with a room or event on any day of `[from, to]` (inclusive), whatever its
 * age — so a booking from last week stays reachable. A room counts when its stay touches the
 * range (arrival on or before `to`, departure on or after `from`); an event when its date is in it.
 * Unpaid online checkouts are left out (they are holds, not bookings yet). `q` matches the guest's
 * name/email or the booking code.
 */
export async function listBookingTransactions(
	hotelId: string,
	range: { from: string; to: string },
	q?: string
): Promise<BookingTransactionRow[]> {
	const [roomHits, hallHits] = await Promise.all([
		db
			.select({ orderId: bookings.orderId })
			.from(bookings)
			.where(
				and(
					eq(bookings.hotelId, hotelId),
					ne(bookings.status, 'pending_payment'),
					lte(bookings.checkIn, range.to),
					gte(bookings.checkOut, range.from)
				)
			),
		db
			.select({ orderId: hallBookings.orderId })
			.from(hallBookings)
			.innerJoin(orders, eq(orders.id, hallBookings.orderId))
			.where(
				and(
					eq(orders.hotelId, hotelId),
					ne(hallBookings.status, 'pending_payment'),
					gte(hallBookings.eventDate, range.from),
					lte(hallBookings.eventDate, range.to)
				)
			)
	]);
	const orderIds = [...new Set([...roomHits, ...hallHits].map((r) => r.orderId))];
	if (orderIds.length === 0) return [];

	const [orderRows, roomLines, hallLines, ledgers] = await Promise.all([
		db
			.select({
				id: orders.id,
				createdAt: orders.createdAt,
				guestName: guests.fullName,
				guestEmail: guests.email
			})
			.from(orders)
			.innerJoin(guests, eq(guests.id, orders.guestId))
			.where(and(eq(orders.hotelId, hotelId), inArray(orders.id, orderIds))),
		db
			.select({
				id: bookings.id,
				orderId: bookings.orderId,
				status: bookings.status,
				checkIn: bookings.checkIn,
				checkOut: bookings.checkOut,
				typeName: roomTypes.name,
				bookingRoomId: bookingRooms.id
			})
			.from(bookings)
			.innerJoin(bookingRooms, eq(bookingRooms.bookingId, bookings.id))
			.innerJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId))
			.where(inArray(bookings.orderId, orderIds)),
		db
			.select({
				orderId: hallBookings.orderId,
				status: hallBookings.status,
				eventDate: hallBookings.eventDate,
				name: functionHalls.name
			})
			.from(hallBookings)
			.innerJoin(functionHalls, eq(functionHalls.id, hallBookings.functionHallId))
			.where(inArray(hallBookings.orderId, orderIds)),
		loadOrderLedgers(orderIds)
	]);

	const nums = roomLines.length
		? await db
				.select({ bookingRoomId: roomAssignments.bookingRoomId, roomNumber: rooms.roomNumber })
				.from(roomAssignments)
				.innerJoin(rooms, eq(rooms.id, roomAssignments.roomId))
				.where(
					inArray(
						roomAssignments.bookingRoomId,
						roomLines.map((l) => l.bookingRoomId)
					)
				)
		: [];

	const needle = q?.trim().toLowerCase() ?? '';
	const out: BookingTransactionRow[] = [];
	for (const o of orderRows) {
		const code = o.id.slice(0, 8).toUpperCase();
		if (
			needle &&
			!o.guestName.toLowerCase().includes(needle) &&
			!o.guestEmail.toLowerCase().includes(needle) &&
			!code.toLowerCase().startsWith(needle)
		)
			continue;

		const rl = roomLines.filter((l) => l.orderId === o.id);
		const hl = hallLines.filter((l) => l.orderId === o.id);
		const labels = [
			...rl.map((l) => {
				const n = nums.filter((x) => x.bookingRoomId === l.bookingRoomId).map((x) => x.roomNumber);
				return n.length ? `Room ${n.join(', ')}` : l.typeName;
			}),
			...hl.map((l) => l.name)
		];
		const starts = [...rl.map((l) => l.checkIn), ...hl.map((l) => l.eventDate)].sort();
		const ends = [...rl.map((l) => l.checkOut), ...hl.map((l) => l.eventDate)].sort();
		const ledger = ledgers.get(o.id);
		out.push({
			orderId: o.id,
			createdAt: o.createdAt.toISOString(),
			code,
			guestName: o.guestName,
			guestEmail: o.guestEmail,
			roomLabel: labels.join(', '),
			checkIn: starts[0] ?? '',
			checkOut: ends[ends.length - 1] ?? '',
			lineCount: rl.length + hl.length,
			status: summariseStatus([...rl.map((l) => l.status), ...hl.map((l) => l.status)]),
			cancelledCount: [...rl.map((l) => l.status), ...hl.map((l) => l.status)].filter(
				(x) => x === 'cancelled' || x === 'no_show'
			).length,
			chargesCentavos: ledger?.chargesTotalCentavos ?? 0,
			paidCentavos: ledger?.paidTotalCentavos ?? 0,
			balanceCentavos: ledger?.balanceCentavos ?? 0
		});
	}
	// Newest booking first.
	return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/** A register row with the columns an exported/printed register needs on top of the list's. */
export interface BookingTransactionExportRow extends BookingTransactionRow {
	/** `Online` when the guest booked and paid through PayMongo; otherwise made at the desk. */
	source: 'Online' | 'Walk-in / staff';
	/** Distinct tenders actually used (cash, gcash, …), voided and refund rows left out. */
	methods: string[];
	/** Card approval codes, e-wallet references and cheque numbers recorded on those payments. */
	references: string[];
	/** The refundable security deposit held or already settled for the booking's rooms. */
	depositCentavos: number;
}

/**
 * `listBookingTransactions` plus source, tender, references and security deposit, for the printed
 * and CSV register. Read-only and additive: the list page keeps using the leaner function.
 */
export async function listBookingTransactionsForExport(
	hotelId: string,
	range: { from: string; to: string },
	q?: string
): Promise<BookingTransactionExportRow[]> {
	const rows = await listBookingTransactions(hotelId, range, q);
	if (rows.length === 0) return [];
	const ids = rows.map((r) => r.orderId);

	const [orderRows, paymentRows, depositRows] = await Promise.all([
		db
			.select({ id: orders.id, session: orders.paymongoCheckoutSessionId })
			.from(orders)
			.where(and(eq(orders.hotelId, hotelId), inArray(orders.id, ids))),
		db
			.select({
				orderId: payments.orderId,
				method: payments.method,
				referenceNo: payments.referenceNo,
				paidAt: payments.paidAt
			})
			.from(payments)
			.innerJoin(orders, eq(orders.id, payments.orderId))
			.where(
				and(
					eq(orders.hotelId, hotelId),
					inArray(payments.orderId, ids),
					eq(payments.status, 'paid'),
					isNull(payments.voidedAt),
					ne(payments.purpose, 'refund')
				)
			)
			.orderBy(asc(payments.createdAt)),
		db
			.select({ orderId: bookings.orderId, amount: securityDeposits.amountCentavos })
			.from(securityDeposits)
			.innerJoin(bookings, eq(bookings.id, securityDeposits.bookingId))
			.where(
				and(
					eq(securityDeposits.hotelId, hotelId),
					inArray(bookings.orderId, ids),
					ne(securityDeposits.status, 'voided')
				)
			)
	]);

	const online = new Set(orderRows.filter((o) => !!o.session).map((o) => o.id));
	const methodsBy = new Map<string, Set<string>>();
	const refsBy = new Map<string, Set<string>>();
	for (const p of paymentRows) {
		if (!methodsBy.has(p.orderId)) methodsBy.set(p.orderId, new Set());
		methodsBy.get(p.orderId)!.add(p.method);
		const ref = p.referenceNo?.trim();
		if (ref) {
			if (!refsBy.has(p.orderId)) refsBy.set(p.orderId, new Set());
			refsBy.get(p.orderId)!.add(ref);
		}
	}
	const depositBy = new Map<string, number>();
	for (const d of depositRows) depositBy.set(d.orderId, (depositBy.get(d.orderId) ?? 0) + d.amount);

	return rows.map((r) => ({
		...r,
		source: online.has(r.orderId) ? 'Online' : 'Walk-in / staff',
		methods: [...(methodsBy.get(r.orderId) ?? [])],
		references: [...(refsBy.get(r.orderId) ?? [])],
		depositCentavos: depositBy.get(r.orderId) ?? 0
	}));
}
