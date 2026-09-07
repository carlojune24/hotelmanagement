import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, inArray, lt, lte, ne, sql } from 'drizzle-orm';
import { db } from './db/index';
import {
	bookingRooms,
	bookings,
	bookingStatusHistory,
	functionHalls,
	guests,
	hallBookings,
	hallBookingStatusHistory,
	orders,
	orderStatusHistory,
	payments,
	ratePlans,
	roomTypes,
	rooms,
	roomAssignments
} from './db/schema/index';
import { ACTIVE_BOOKING_STATUSES, getAvailableRoomType } from './availability';
import { checkHallAvailability } from './hall-availability';
import { FolioError, closeFolio, getFolioDetail } from './folio';
import { priceEventHall } from './pricing';
import { scaleRoomPrice } from '$lib/pricing-utils';
import { writeAudit } from './audit';
import type { SessionUser } from './auth/session';

/** Today's date (`YYYY-MM-DD`) in a hotel's own timezone — the front desk's "business date". */
export function todayInTimezone(timezone: string): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
}

export class CheckInError extends Error {}

/**
 * Physical rooms of the given type that are actually free for `[checkIn, checkOut)` —
 * active, not out of order, and not already assigned (on an active-status booking) to
 * an overlapping range. Same half-open-interval overlap test `searchAvailability` uses
 * for room-type counts, just scoped to one physical room.
 */
export async function listEligibleRooms(hotelId: string, roomTypeId: string, checkIn: string, checkOut: string) {
	const candidates = await db
		.select({ id: rooms.id, roomNumber: rooms.roomNumber, floor: rooms.floor })
		.from(rooms)
		.where(
			and(
				eq(rooms.hotelId, hotelId),
				eq(rooms.roomTypeId, roomTypeId),
				eq(rooms.isActive, true),
				eq(rooms.operationalStatus, 'available')
			)
		)
		.orderBy(asc(rooms.sortOrder), asc(rooms.roomNumber));
	if (candidates.length === 0) return [];

	const occupiedRows = await db
		.select({ roomId: roomAssignments.roomId })
		.from(roomAssignments)
		.innerJoin(bookingRooms, eq(bookingRooms.id, roomAssignments.bookingRoomId))
		.innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId))
		.where(
			and(
				inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES]),
				lt(roomAssignments.checkIn, checkOut),
				gt(roomAssignments.checkOut, checkIn)
			)
		);
	const occupied = new Set(occupiedRows.map((r) => r.roomId));

	return candidates.filter((r) => !occupied.has(r.id));
}

/**
 * Assigns specific physical rooms to a confirmed booking and flips it to
 * `checked_in`. Every condition the UI already filtered for is re-verified here
 * server-side — the form's own options are a convenience, never the real guard.
 */
export async function checkInBooking(
	hotelId: string,
	bookingId: string,
	roomIds: string[],
	actor: SessionUser | null
): Promise<void> {
	const uniqueRoomIds = [...new Set(roomIds)];
	if (uniqueRoomIds.length !== roomIds.length) {
		throw new CheckInError('Each room can only be assigned once.');
	}

	await db.transaction(async (tx) => {
		for (const roomId of [...uniqueRoomIds].sort()) {
			await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${hotelId}), hashtext(${'room:' + roomId}))`);
		}

		const [booking] = await tx
			.select()
			.from(bookings)
			.where(eq(bookings.id, bookingId))
			.limit(1);
		if (!booking || booking.hotelId !== hotelId) throw new CheckInError('Booking not found.');
		if (booking.status !== 'confirmed') {
			throw new CheckInError('Only a confirmed booking can be checked in.');
		}

		const [order] = await tx.select().from(orders).where(eq(orders.id, booking.orderId)).limit(1);
		if (!order || order.status !== 'confirmed') {
			throw new CheckInError('This booking has not been paid — cannot check in.');
		}

		const [bookingRoom] = await tx
			.select()
			.from(bookingRooms)
			.where(eq(bookingRooms.bookingId, bookingId))
			.limit(1);
		if (!bookingRoom) throw new CheckInError('Booking has no room line.');
		if (uniqueRoomIds.length !== bookingRoom.quantity) {
			throw new CheckInError(`Select exactly ${bookingRoom.quantity} room(s).`);
		}

		const roomRows = await tx
			.select()
			.from(rooms)
			.where(
				and(
					inArray(rooms.id, uniqueRoomIds),
					eq(rooms.hotelId, hotelId),
					eq(rooms.roomTypeId, bookingRoom.roomTypeId),
					eq(rooms.isActive, true),
					eq(rooms.operationalStatus, 'available')
				)
			);
		if (roomRows.length !== uniqueRoomIds.length) {
			throw new CheckInError('One or more selected rooms are no longer available.');
		}

		const occupiedRows = await tx
			.select({ roomId: roomAssignments.roomId })
			.from(roomAssignments)
			.innerJoin(bookingRooms, eq(bookingRooms.id, roomAssignments.bookingRoomId))
			.innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId))
			.where(
				and(
					inArray(roomAssignments.roomId, uniqueRoomIds),
					inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES]),
					ne(bookings.id, bookingId),
					lt(roomAssignments.checkIn, booking.checkOut),
					gt(roomAssignments.checkOut, booking.checkIn)
				)
			);
		if (occupiedRows.length > 0) {
			throw new CheckInError('One or more selected rooms were just taken — pick again.');
		}

		await tx.insert(roomAssignments).values(
			uniqueRoomIds.map((roomId) => ({
				bookingRoomId: bookingRoom.id,
				roomId,
				checkIn: booking.checkIn,
				checkOut: booking.checkOut
			}))
		);

		await tx.update(bookings).set({ status: 'checked_in', updatedAt: new Date() }).where(eq(bookings.id, bookingId));

		await tx.insert(bookingStatusHistory).values({
			bookingId,
			fromStatus: 'confirmed',
			toStatus: 'checked_in',
			note: null
		});
	});

	await writeAudit({
		hotelId,
		actor,
		action: 'booking.check_in',
		entityType: 'booking',
		entityId: bookingId,
		after: { roomIds: uniqueRoomIds }
	});
}

export interface RoomGridOccupant {
	bookingId: string;
	guestName: string;
	guestEmail: string;
	guestPhone: string | null;
	specialRequests: string | null;
	checkIn: string;
	checkOut: string;
	occupancy: number;
	ratePlanName: string;
	totalCentavos: number;
	/** `payments.provider` for the order's paid payment — `'cash'` (walk-in) or `'paymongo'` (booked online). */
	channel: string;
}

/** A confirmed booking arriving `businessDate` whose room type has no physical room assigned yet. */
export interface RoomGridArrival {
	bookingId: string;
	guestName: string;
	roomTypeName: string;
	channel: string;
}

export interface RoomGridDeparture {
	bookingId: string;
	guestName: string;
	roomId: string;
	roomNumber: string;
	roomTypeName: string;
}

export type RoomGridStatus = 'vacant' | 'occupied' | 'departing' | 'reserved' | 'ooo';

export interface RoomGridCell {
	roomId: string;
	roomNumber: string;
	floor: string | null;
	roomTypeId: string;
	roomTypeName: string;
	status: RoomGridStatus;
	/** `rooms.notes` — only meaningful (and only shown) for `ooo`. */
	notes: string | null;
	occupant: RoomGridOccupant | null;
	/** Non-empty only when `status === 'reserved'` — every unassigned confirmed arrival of this room's type, not specifically this room (see the type's own doc comment). */
	expectedArrivals: RoomGridArrival[];
}

/**
 * The front desk's room-status board for `businessDate`: every physical room,
 * colored by what's actually happening in it right now, plus the flat
 * arrivals/departures lists the side rail's default view uses. Unlike the
 * booking-centric list this replaced, this starts from `rooms` so a genuinely
 * vacant room (no booking at all) still shows up — the whole point of a rack
 * view. A room's "reserved" flag can only ever point at its *room type*, never
 * a specific arrival: `room_assignments` rows don't exist until check-in, so
 * an arriving guest has no physical room yet by definition.
 */
export async function getRoomStatusGrid(
	hotelId: string,
	businessDate: string
): Promise<{ cells: RoomGridCell[]; arrivals: RoomGridArrival[]; departures: RoomGridDeparture[] }> {
	const roomRows = await db
		.select({
			roomId: rooms.id,
			roomNumber: rooms.roomNumber,
			floor: rooms.floor,
			notes: rooms.notes,
			operationalStatus: rooms.operationalStatus,
			roomTypeId: rooms.roomTypeId,
			roomTypeName: roomTypes.name
		})
		.from(rooms)
		.innerJoin(roomTypes, eq(roomTypes.id, rooms.roomTypeId))
		.where(and(eq(rooms.hotelId, hotelId), eq(rooms.isActive, true)))
		.orderBy(asc(rooms.floor), asc(rooms.sortOrder), asc(rooms.roomNumber));
	if (roomRows.length === 0) return { cells: [], arrivals: [], departures: [] };

	const occupantRows = await db
		.select({
			roomId: roomAssignments.roomId,
			bookingId: bookings.id,
			assignmentCheckIn: roomAssignments.checkIn,
			assignmentCheckOut: roomAssignments.checkOut,
			occupancy: bookings.occupancy,
			totalCentavos: bookings.totalCentavos,
			ratePlanName: ratePlans.name,
			guestName: guests.fullName,
			guestEmail: guests.email,
			guestPhone: guests.phone,
			specialRequests: guests.specialRequests,
			orderId: orders.id
		})
		.from(roomAssignments)
		.innerJoin(bookingRooms, eq(bookingRooms.id, roomAssignments.bookingRoomId))
		.innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId))
		.innerJoin(ratePlans, eq(ratePlans.id, bookingRooms.ratePlanId))
		.innerJoin(orders, eq(orders.id, bookings.orderId))
		.innerJoin(guests, eq(guests.id, orders.guestId))
		.where(
			and(
				eq(bookings.hotelId, hotelId),
				eq(bookings.status, 'checked_in'),
				lte(roomAssignments.checkIn, businessDate),
				gt(roomAssignments.checkOut, businessDate)
			)
		);

	const arrivalRows = await db
		.select({
			roomTypeId: bookingRooms.roomTypeId,
			roomTypeName: roomTypes.name,
			bookingId: bookings.id,
			guestName: guests.fullName,
			orderId: orders.id,
			assignmentId: roomAssignments.id
		})
		.from(bookings)
		.innerJoin(bookingRooms, eq(bookingRooms.bookingId, bookings.id))
		.innerJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId))
		.innerJoin(orders, eq(orders.id, bookings.orderId))
		.innerJoin(guests, eq(guests.id, orders.guestId))
		.leftJoin(roomAssignments, eq(roomAssignments.bookingRoomId, bookingRooms.id))
		.where(
			and(
				eq(bookings.hotelId, hotelId),
				eq(bookings.checkIn, businessDate),
				eq(bookings.status, 'confirmed')
			)
		);
	const unassignedArrivals = arrivalRows.filter((r) => r.assignmentId == null);

	const orderIds = [...new Set([...occupantRows.map((r) => r.orderId), ...unassignedArrivals.map((r) => r.orderId)])];
	const channelByOrder = new Map<string, string>();
	if (orderIds.length > 0) {
		const paymentRows = await db
			.select({ orderId: payments.orderId, provider: payments.provider })
			.from(payments)
			.where(and(inArray(payments.orderId, orderIds), eq(payments.status, 'paid')));
		for (const p of paymentRows) {
			if (!channelByOrder.has(p.orderId)) channelByOrder.set(p.orderId, p.provider);
		}
	}

	const arrivalsByRoomType = new Map<string, RoomGridArrival[]>();
	const arrivals: RoomGridArrival[] = unassignedArrivals.map((r) => {
		const arrival: RoomGridArrival = {
			bookingId: r.bookingId,
			guestName: r.guestName,
			roomTypeName: r.roomTypeName,
			channel: channelByOrder.get(r.orderId) ?? 'paymongo'
		};
		const list = arrivalsByRoomType.get(r.roomTypeId) ?? [];
		list.push(arrival);
		arrivalsByRoomType.set(r.roomTypeId, list);
		return arrival;
	});

	const occupantByRoomId = new Map(occupantRows.map((r) => [r.roomId, r]));
	const departures: RoomGridDeparture[] = [];

	const cells: RoomGridCell[] = roomRows.map((room) => {
		const occ = occupantByRoomId.get(room.roomId);
		let status: RoomGridStatus;
		let occupant: RoomGridOccupant | null = null;

		if (occ) {
			occupant = {
				bookingId: occ.bookingId,
				guestName: occ.guestName,
				guestEmail: occ.guestEmail,
				guestPhone: occ.guestPhone,
				specialRequests: occ.specialRequests,
				checkIn: occ.assignmentCheckIn,
				checkOut: occ.assignmentCheckOut,
				occupancy: occ.occupancy,
				ratePlanName: occ.ratePlanName,
				totalCentavos: occ.totalCentavos,
				channel: channelByOrder.get(occ.orderId) ?? 'paymongo'
			};
			status = occ.assignmentCheckOut === businessDate ? 'departing' : 'occupied';
			if (status === 'departing') {
				departures.push({
					bookingId: occ.bookingId,
					guestName: occ.guestName,
					roomId: room.roomId,
					roomNumber: room.roomNumber,
					roomTypeName: room.roomTypeName
				});
			}
		} else if (room.operationalStatus !== 'available') {
			status = 'ooo';
		} else if (arrivalsByRoomType.has(room.roomTypeId)) {
			status = 'reserved';
		} else {
			status = 'vacant';
		}

		return {
			roomId: room.roomId,
			roomNumber: room.roomNumber,
			floor: room.floor,
			roomTypeId: room.roomTypeId,
			roomTypeName: room.roomTypeName,
			status,
			notes: room.notes,
			occupant,
			expectedArrivals: status === 'reserved' ? (arrivalsByRoomType.get(room.roomTypeId) ?? []) : []
		};
	});

	return { cells, arrivals, departures };
}

export class WalkInError extends Error {}

/**
 * Creates a guest + order + booking directly as `confirmed`, with a `cash`
 * payment row for the full total — a walk-in is settled at the desk on the
 * spot, not through the guest-facing PayMongo checkout `book/details`'s
 * `createOrder` action drives. Re-verifies availability and re-prices
 * server-side exactly like that action does; deliberately mirrors its
 * lock/verify/insert shape rather than reusing it directly, since a walk-in
 * skips the pending-payment step and cart entirely.
 */
export async function createWalkInBooking(params: {
	hotelId: string;
	guest: { fullName: string; email: string; phone: string | null; specialRequests: string | null };
	roomTypeId: string;
	ratePlanId: string;
	checkIn: string;
	checkOut: string;
	occupancy: number;
	roomCount: number;
	actor: SessionUser | null;
}): Promise<{ bookingId: string }> {
	const { hotelId, guest, roomTypeId, ratePlanId, checkIn, checkOut, occupancy, roomCount, actor } =
		params;
	if (checkIn >= checkOut) throw new WalkInError('Check-out must be after check-in.');

	const bookingId = await db.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${hotelId}), hashtext(${'room:' + roomTypeId}))`);

		const available = await getAvailableRoomType({
			hotelId,
			checkIn,
			checkOut,
			occupancy,
			roomCount,
			roomTypeId
		});
		const plan = available?.ratePlans.find((p) => p.id === ratePlanId);
		if (!available || !plan) {
			throw new WalkInError('That room type/rate is no longer available for these dates.');
		}
		const price = scaleRoomPrice(plan.price, roomCount);
		const lineFees = price.fees.reduce((sum, f) => sum + f.amountCentavos, 0);

		const [guestRow] = await tx
			.insert(guests)
			.values({
				hotelId,
				fullName: guest.fullName.trim(),
				email: guest.email.trim().toLowerCase(),
				phone: guest.phone?.trim() || null,
				specialRequests: guest.specialRequests?.trim() || null
			})
			.returning({ id: guests.id });

		const [order] = await tx
			.insert(orders)
			.values({
				hotelId,
				guestId: guestRow!.id,
				status: 'confirmed',
				subtotalCentavos: price.subtotalCentavos,
				feesCentavos: lineFees,
				vatCentavos: price.vatCentavos,
				totalCentavos: price.totalCentavos,
				accessToken: randomUUID()
			})
			.returning({ id: orders.id });

		await tx.insert(orderStatusHistory).values({
			orderId: order!.id,
			fromStatus: null,
			toStatus: 'confirmed',
			note: 'Walk-in — settled at front desk'
		});

		await tx.insert(payments).values({
			orderId: order!.id,
			provider: 'cash',
			status: 'paid',
			amountCentavos: price.totalCentavos,
			paidAt: new Date()
		});

		const [booking] = await tx
			.insert(bookings)
			.values({
				hotelId,
				orderId: order!.id,
				checkIn,
				checkOut,
				occupancy,
				status: 'confirmed',
				subtotalCentavos: price.subtotalCentavos,
				feesCentavos: lineFees,
				vatCentavos: price.vatCentavos,
				totalCentavos: price.totalCentavos
			})
			.returning({ id: bookings.id });

		await tx.insert(bookingRooms).values({
			bookingId: booking!.id,
			roomTypeId,
			ratePlanId,
			quantity: roomCount
		});

		await tx.insert(bookingStatusHistory).values({
			bookingId: booking!.id,
			fromStatus: null,
			toStatus: 'confirmed',
			note: 'Walk-in booking'
		});

		return booking!.id;
	});

	await writeAudit({
		hotelId,
		actor,
		action: 'booking.walk_in',
		entityType: 'booking',
		entityId: bookingId,
		after: { roomTypeId, ratePlanId, checkIn, checkOut, occupancy, roomCount }
	});

	return { bookingId };
}

export class CheckOutError extends Error {}

/** Flips a checked-in booking to `checked_out` — refuses while the booking's folio (see
 *  `lib/server/folio.ts`) still carries an outstanding balance. No invoice/OR generation yet
 *  (see docs/TODO.md). */
export async function checkOutBooking(
	hotelId: string,
	bookingId: string,
	businessDate: string,
	actor: SessionUser | null
): Promise<void> {
	let folio;
	try {
		folio = await getFolioDetail(hotelId, { kind: 'room', bookingId });
	} catch (e) {
		if (e instanceof FolioError) throw new CheckOutError(e.message);
		throw e;
	}
	if (folio.balanceCentavos > 0) {
		throw new CheckOutError(
			`Settle the outstanding balance of ₱${(folio.balanceCentavos / 100).toFixed(2)} before checking out.`
		);
	}

	await db.transaction(async (tx) => {
		const [booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
		if (!booking || booking.hotelId !== hotelId) throw new CheckOutError('Booking not found.');
		if (booking.status !== 'checked_in') {
			throw new CheckOutError('Only a checked-in booking can be checked out.');
		}
		const isEarly = businessDate < booking.checkOut;

		await tx
			.update(bookings)
			.set({ status: 'checked_out', updatedAt: new Date() })
			.where(eq(bookings.id, bookingId));

		// Early checkout: cap the physical-room assignment at today instead of leaving it
		// blocked through the originally booked checkOut date — otherwise the room would
		// read as vacant on the front-desk grid while availability checks (which still treat
		// a checked_out booking as occupying its full stored range) silently keep refusing to
		// assign it to anyone else for the nights the guest gave up. A no-op for an on-time
		// or late checkout, where the assignment's checkOut is already <= businessDate.
		if (isEarly) {
			const [bookingRoom] = await tx
				.select({ id: bookingRooms.id })
				.from(bookingRooms)
				.where(eq(bookingRooms.bookingId, bookingId))
				.limit(1);
			if (bookingRoom) {
				await tx
					.update(roomAssignments)
					.set({ checkOut: businessDate })
					.where(and(eq(roomAssignments.bookingRoomId, bookingRoom.id), gt(roomAssignments.checkOut, businessDate)));
			}
		}

		await tx.insert(bookingStatusHistory).values({
			bookingId,
			fromStatus: 'checked_in',
			toStatus: 'checked_out',
			note: isEarly ? `Early check-out (originally due ${booking.checkOut})` : null
		});
	});

	await writeAudit({
		hotelId,
		actor,
		action: 'booking.check_out',
		entityType: 'booking',
		entityId: bookingId
	});

	await closeFolio(hotelId, bookingId);
}

export interface HallGridEvent {
	hallBookingId: string;
	guestName: string;
	eventType: string;
	guestCount: number;
	startTime: string;
	endTime: string;
	status: string;
	totalCentavos: number;
	channel: string;
}

export interface HallGridCell {
	functionHallId: string;
	hallName: string;
	capacity: number;
	/** Hours included in the base price before the extra-hour rate kicks in — the walk-in drawer defaults a new event's duration to this. */
	baseHours: number;
	events: HallGridEvent[];
}

/**
 * The front desk's function-hall board for `businessDate` — every active hall
 * a hotel has, with whatever paid (`confirmed`/`completed`) events are booked
 * on it today. Unlike rooms, a hall never needs physical assignment (the hall
 * *is* the bookable unit) or a check-in step, so there's no "reserved" vs.
 * "occupied" split here — just today's event list per hall.
 */
export async function getHallStatusBoard(hotelId: string, businessDate: string): Promise<HallGridCell[]> {
	const hallRows = await db
		.select({
			id: functionHalls.id,
			name: functionHalls.name,
			capacity: functionHalls.capacity,
			baseHours: functionHalls.baseHours
		})
		.from(functionHalls)
		.where(and(eq(functionHalls.hotelId, hotelId), eq(functionHalls.isActive, true)))
		.orderBy(asc(functionHalls.sortOrder), asc(functionHalls.name));
	if (hallRows.length === 0) return [];

	const eventRows = await db
		.select({
			hallBookingId: hallBookings.id,
			functionHallId: hallBookings.functionHallId,
			eventType: hallBookings.eventType,
			guestCount: hallBookings.guestCount,
			startTime: hallBookings.startTime,
			endTime: hallBookings.endTime,
			status: hallBookings.status,
			totalCentavos: hallBookings.totalCentavos,
			guestName: guests.fullName,
			orderId: orders.id
		})
		.from(hallBookings)
		.innerJoin(orders, eq(orders.id, hallBookings.orderId))
		.innerJoin(guests, eq(guests.id, orders.guestId))
		.where(
			and(
				eq(orders.hotelId, hotelId),
				eq(hallBookings.eventDate, businessDate),
				inArray(hallBookings.status, ['confirmed', 'completed'])
			)
		);

	const orderIds = [...new Set(eventRows.map((r) => r.orderId))];
	const channelByOrder = new Map<string, string>();
	if (orderIds.length > 0) {
		const paymentRows = await db
			.select({ orderId: payments.orderId, provider: payments.provider })
			.from(payments)
			.where(and(inArray(payments.orderId, orderIds), eq(payments.status, 'paid')));
		for (const p of paymentRows) {
			if (!channelByOrder.has(p.orderId)) channelByOrder.set(p.orderId, p.provider);
		}
	}

	const eventsByHall = new Map<string, HallGridEvent[]>();
	for (const r of eventRows) {
		const list = eventsByHall.get(r.functionHallId) ?? [];
		list.push({
			hallBookingId: r.hallBookingId,
			guestName: r.guestName,
			eventType: r.eventType,
			guestCount: r.guestCount,
			startTime: r.startTime,
			endTime: r.endTime,
			status: r.status,
			totalCentavos: r.totalCentavos,
			channel: channelByOrder.get(r.orderId) ?? 'paymongo'
		});
		eventsByHall.set(r.functionHallId, list);
	}
	for (const list of eventsByHall.values()) list.sort((a, b) => a.startTime.localeCompare(b.startTime));

	return hallRows.map((h) => ({
		functionHallId: h.id,
		hallName: h.name,
		capacity: h.capacity,
		baseHours: h.baseHours,
		events: eventsByHall.get(h.id) ?? []
	}));
}

export class HallWalkInError extends Error {}

/** Same posture as `createWalkInBooking`, for a function hall — settled in cash on the spot, confirmed immediately. */
export async function createWalkInHallBooking(params: {
	hotelId: string;
	guest: { fullName: string; email: string; phone: string | null; specialRequests: string | null };
	functionHallId: string;
	eventDate: string;
	startTime: string;
	endTime: string;
	eventType: string;
	guestCount: number;
	actor: SessionUser | null;
}): Promise<{ hallBookingId: string }> {
	const { hotelId, guest, functionHallId, eventDate, startTime, endTime, eventType, guestCount, actor } = params;

	const hallBookingId = await db.transaction(async (tx) => {
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtext(${hotelId}), hashtext(${'hall:' + functionHallId + ':' + eventDate}))`
		);

		const available = await checkHallAvailability({ hotelId, functionHallId, eventDate, startTime, endTime });
		if (!available) throw new HallWalkInError('That function hall slot is no longer available.');

		const price = await priceEventHall({ hotelId, functionHallId, startTime, endTime });
		const lineFees = price.fees.reduce((sum, f) => sum + f.amountCentavos, 0);

		const [guestRow] = await tx
			.insert(guests)
			.values({
				hotelId,
				fullName: guest.fullName.trim(),
				email: guest.email.trim().toLowerCase(),
				phone: guest.phone?.trim() || null,
				specialRequests: guest.specialRequests?.trim() || null
			})
			.returning({ id: guests.id });

		const [order] = await tx
			.insert(orders)
			.values({
				hotelId,
				guestId: guestRow!.id,
				status: 'confirmed',
				subtotalCentavos: price.subtotalCentavos,
				feesCentavos: lineFees,
				vatCentavos: price.vatCentavos,
				totalCentavos: price.totalCentavos,
				accessToken: randomUUID()
			})
			.returning({ id: orders.id });

		await tx.insert(orderStatusHistory).values({
			orderId: order!.id,
			fromStatus: null,
			toStatus: 'confirmed',
			note: 'Walk-in — settled at front desk'
		});

		await tx.insert(payments).values({
			orderId: order!.id,
			provider: 'cash',
			status: 'paid',
			amountCentavos: price.totalCentavos,
			paidAt: new Date()
		});

		const [hallBooking] = await tx
			.insert(hallBookings)
			.values({
				orderId: order!.id,
				functionHallId,
				eventDate,
				startTime,
				endTime,
				eventType,
				guestCount,
				status: 'confirmed',
				subtotalCentavos: price.subtotalCentavos,
				feesCentavos: lineFees,
				vatCentavos: price.vatCentavos,
				totalCentavos: price.totalCentavos
			})
			.returning({ id: hallBookings.id });

		await tx.insert(hallBookingStatusHistory).values({
			hallBookingId: hallBooking!.id,
			fromStatus: null,
			toStatus: 'confirmed',
			note: 'Walk-in booking'
		});

		return hallBooking!.id;
	});

	await writeAudit({
		hotelId,
		actor,
		action: 'hall_booking.walk_in',
		entityType: 'hall_booking',
		entityId: hallBookingId,
		after: { functionHallId, eventDate, startTime, endTime, eventType, guestCount }
	});

	return { hallBookingId };
}

export class HallCompleteError extends Error {}

/** Flips a confirmed event to `completed` once it's over — front desk's judgment call, nothing tracks the actual end time. */
export async function completeHallBooking(
	hotelId: string,
	hallBookingId: string,
	actor: SessionUser | null
): Promise<void> {
	await db.transaction(async (tx) => {
		const [row] = await tx
			.select({ id: hallBookings.id, status: hallBookings.status })
			.from(hallBookings)
			.innerJoin(orders, eq(orders.id, hallBookings.orderId))
			.where(and(eq(hallBookings.id, hallBookingId), eq(orders.hotelId, hotelId)))
			.limit(1);
		if (!row) throw new HallCompleteError('Hall booking not found.');
		if (row.status !== 'confirmed') {
			throw new HallCompleteError('Only a confirmed event can be marked completed.');
		}

		await tx.update(hallBookings).set({ status: 'completed' }).where(eq(hallBookings.id, hallBookingId));

		await tx.insert(hallBookingStatusHistory).values({
			hallBookingId,
			fromStatus: 'confirmed',
			toStatus: 'completed',
			note: null
		});
	});

	await writeAudit({
		hotelId,
		actor,
		action: 'hall_booking.complete',
		entityType: 'hall_booking',
		entityId: hallBookingId
	});
}
