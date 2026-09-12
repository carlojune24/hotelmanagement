import { and, count, eq, gt, gte, inArray, lt, lte, ne, sql } from 'drizzle-orm';
import { db } from './db/index';
import {
	bookingRooms,
	bookings,
	bookingStatusHistory,
	dailyRates,
	folioCharges,
	hotels,
	orders,
	ratePlans,
	roomAssignments,
	rooms,
	seasonalRates
} from './db/schema/index';
import { ACTIVE_BOOKING_STATUSES } from './availability';
import { ensureFolio } from './folio';
import { writeAudit } from './audit';
import type { SessionUser } from './auth/session';
import { nightsBetween, resolveNightlyRates } from './pricing';

export class ModifyStayError extends Error {}

/** The transaction object `db.transaction(async (tx) => ...)` hands its callback — same
 *  pattern `folio.ts` uses so this stays correct regardless of the configured driver. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

/** One contiguous run of nights added or removed on one edge of the stay (front = around
 *  check-in, back = around check-out). A modify can touch either edge independently, never
 *  both directions on the same edge at once. `nights` is always sorted ascending. */
export interface DateSegment {
	edge: 'front' | 'back';
	direction: 'added' | 'removed';
	nights: string[];
}

/** Pure — extracted so the front/back, added/removed date math can be unit-tested without
 *  a database. Exported for `booking-modify.test.ts`. */
export function diffSegments(
	oldCheckIn: string,
	oldCheckOut: string,
	newCheckIn: string,
	newCheckOut: string
): DateSegment[] {
	const segments: DateSegment[] = [];
	if (newCheckIn < oldCheckIn) {
		segments.push({ edge: 'front', direction: 'added', nights: nightsBetween(newCheckIn, oldCheckIn) });
	} else if (newCheckIn > oldCheckIn) {
		segments.push({ edge: 'front', direction: 'removed', nights: nightsBetween(oldCheckIn, newCheckIn) });
	}
	if (newCheckOut > oldCheckOut) {
		segments.push({ edge: 'back', direction: 'added', nights: nightsBetween(oldCheckOut, newCheckOut) });
	} else if (newCheckOut < oldCheckOut) {
		segments.push({ edge: 'back', direction: 'removed', nights: nightsBetween(newCheckOut, oldCheckOut) });
	}
	return segments;
}

/** The night list's implied checkout (exclusive) — one day past its last night. */
export function segCheckOutFor(nights: string[]): string {
	const last = nights[nights.length - 1]!;
	const d = new Date(`${last}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + 1);
	return d.toISOString().slice(0, 10);
}

/** Prices a specific set of (already-contiguous) nights at today's rates for one rate
 *  plan — the nightly-rate portion only, VAT on top, no `taxes_fees` re-application.
 *  Deliberately narrower than `pricing.ts`'s `priceStay`: a modify's added nights are new
 *  revenue and should re-price at today's rates, but re-running the hotel's fixed/per-stay
 *  fees (reservation fee, resort fee) here would double-charge them — those were already
 *  settled once on the booking's original total. Documented v1 simplification. */
async function priceNights(
	hotelId: string,
	ratePlanId: string,
	nights: string[]
): Promise<{ subtotalCentavos: number; vatCentavos: number; totalCentavos: number }> {
	const [hotel] = await db.select().from(hotels).where(eq(hotels.id, hotelId)).limit(1);
	if (!hotel) throw new ModifyStayError('Hotel not found.');
	const [ratePlan] = await db
		.select()
		.from(ratePlans)
		.where(and(eq(ratePlans.id, ratePlanId), eq(ratePlans.hotelId, hotelId)))
		.limit(1);
	if (!ratePlan) throw new ModifyStayError('Rate plan not found.');

	const first = nights[0]!;
	const last = nights[nights.length - 1]!;
	const [overrides, seasons] = await Promise.all([
		db
			.select({ date: dailyRates.date, priceCentavos: dailyRates.priceCentavos })
			.from(dailyRates)
			.where(and(eq(dailyRates.ratePlanId, ratePlanId), inArray(dailyRates.date, nights))),
		db
			.select({
				startDate: seasonalRates.startDate,
				endDate: seasonalRates.endDate,
				priceCentavos: seasonalRates.priceCentavos,
				multiplierBps: seasonalRates.multiplierBps
			})
			.from(seasonalRates)
			.where(and(eq(seasonalRates.ratePlanId, ratePlanId), lte(seasonalRates.startDate, last), gte(seasonalRates.endDate, first)))
	]);

	const nightly = resolveNightlyRates(
		nights,
		{
			basePriceCentavos: ratePlan.basePriceCentavos,
			weekendPriceCentavos: ratePlan.weekendPriceCentavos,
			weekendDays: ratePlan.weekendDays
		},
		new Map(overrides.map((o) => [o.date, o.priceCentavos])),
		seasons
	);
	const subtotalCentavos = nightly.reduce((sum, n) => sum + n.priceCentavos, 0);
	const vatCentavos = Math.round((subtotalCentavos * hotel.vatRateBps) / 10000);
	return { subtotalCentavos, vatCentavos, totalCentavos: subtotalCentavos + vatCentavos };
}

/** Room-type capacity free for one date range. Safe to call for a modify's added segment
 *  without excluding this booking's own row: that segment sits strictly outside the
 *  booking's current stored range, so it can't self-overlap. Mirrors `availability.ts`'s
 *  own booked-rows counting, scoped to one room type. */
async function roomTypeCapacityFor(
	hotelId: string,
	roomTypeId: string,
	checkIn: string,
	checkOut: string
): Promise<number> {
	const [totalRows, bookedRows] = await Promise.all([
		db
			.select({ n: count() })
			.from(rooms)
			.where(
				and(
					eq(rooms.hotelId, hotelId),
					eq(rooms.roomTypeId, roomTypeId),
					eq(rooms.isActive, true),
					eq(rooms.operationalStatus, 'available')
				)
			),
		db
			.select({ quantity: bookingRooms.quantity })
			.from(bookingRooms)
			.innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId))
			.where(
				and(
					eq(bookings.hotelId, hotelId),
					eq(bookingRooms.roomTypeId, roomTypeId),
					inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES]),
					lt(bookings.checkIn, checkOut),
					gt(bookings.checkOut, checkIn)
				)
			)
	]);
	const total = totalRows[0]?.n ?? 0;
	const booked = bookedRows.reduce((sum, r) => sum + r.quantity, 0);
	return total - booked;
}

/** For a checked-in booking's assigned physical room(s): the room number of the first one
 *  that's already claimed by another active booking over `[checkIn, checkOut)`, or null if
 *  every assigned room is free for that range. */
async function findRoomConflict(
	executor: Executor,
	bookingRoomId: string,
	checkIn: string,
	checkOut: string
): Promise<string | null> {
	const assignments = await executor
		.select({ roomId: roomAssignments.roomId, roomNumber: rooms.roomNumber })
		.from(roomAssignments)
		.innerJoin(rooms, eq(rooms.id, roomAssignments.roomId))
		.where(eq(roomAssignments.bookingRoomId, bookingRoomId));

	for (const a of assignments) {
		const conflict = await executor
			.select({ id: roomAssignments.id })
			.from(roomAssignments)
			.innerJoin(bookingRooms, eq(bookingRooms.id, roomAssignments.bookingRoomId))
			.innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId))
			.where(
				and(
					eq(roomAssignments.roomId, a.roomId),
					ne(bookingRooms.id, bookingRoomId),
					inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES]),
					lt(roomAssignments.checkIn, checkOut),
					gt(roomAssignments.checkOut, checkIn)
				)
			)
			.limit(1);
		if (conflict.length > 0) return a.roomNumber;
	}
	return null;
}

async function loadModifiable(hotelId: string, bookingId: string, executor: Executor) {
	const [row] = await executor
		.select({ booking: bookings, order: orders, bookingRoom: bookingRooms })
		.from(bookings)
		.innerJoin(orders, eq(orders.id, bookings.orderId))
		.innerJoin(bookingRooms, eq(bookingRooms.bookingId, bookings.id))
		.where(and(eq(bookings.id, bookingId), eq(bookings.hotelId, hotelId)))
		.limit(1);
	if (!row) throw new ModifyStayError('Booking not found.');
	if (row.booking.status !== 'confirmed' && row.booking.status !== 'checked_in') {
		throw new ModifyStayError(`A ${row.booking.status.replace(/_/g, ' ')} booking can't have its dates changed.`);
	}
	if (row.order.status !== 'confirmed') {
		throw new ModifyStayError('This booking has not been paid — cannot modify dates.');
	}
	return row;
}

function validateRange(newCheckIn: string, newCheckOut: string, isCheckedIn: boolean, oldCheckIn: string) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(newCheckIn) || !/^\d{4}-\d{2}-\d{2}$/.test(newCheckOut)) {
		throw new ModifyStayError('Enter valid dates.');
	}
	if (newCheckIn >= newCheckOut) throw new ModifyStayError('Check-out must be after check-in.');
	if (isCheckedIn && newCheckIn !== oldCheckIn) {
		throw new ModifyStayError("A checked-in guest's check-in date can't be changed.");
	}
}

export interface ModifyStaySegmentQuote {
	edge: 'front' | 'back';
	direction: 'added' | 'removed';
	nights: string[];
	/** Always a non-negative magnitude — `direction` says whether it charges or credits. */
	amountCentavos: number;
}

interface PlannedModification {
	segments: ModifyStaySegmentQuote[];
	/** Net folio effect: positive = additional charge, negative = credit. */
	deltaCentavos: number;
	/** Set when the requested range can't actually be honored. */
	blockingReason: string | null;
}

/** Shared by the read-only quote and the real commit: works out each changed edge's
 *  segment, its price/credit, and whether inventory/room-assignment allows it. Never
 *  mutates anything itself. */
async function planModification(
	executor: Executor,
	hotelId: string,
	booking: typeof bookings.$inferSelect,
	bookingRoom: typeof bookingRooms.$inferSelect,
	newCheckIn: string,
	newCheckOut: string
): Promise<PlannedModification> {
	const rawSegments = diffSegments(booking.checkIn, booking.checkOut, newCheckIn, newCheckOut);
	const originalNights = nightsBetween(booking.checkIn, booking.checkOut).length;
	const isCheckedIn = booking.status === 'checked_in';

	let blockingReason: string | null = null;
	const segments: ModifyStaySegmentQuote[] = [];

	for (const seg of rawSegments) {
		if (seg.direction === 'removed') {
			const credit = Math.round((booking.totalCentavos * seg.nights.length) / originalNights);
			segments.push({ edge: seg.edge, direction: 'removed', nights: seg.nights, amountCentavos: credit });
			continue;
		}

		const segCheckIn = seg.nights[0]!;
		const segCheckOut = segCheckOutFor(seg.nights);
		const priced = await priceNights(hotelId, bookingRoom.ratePlanId, seg.nights);
		segments.push({ edge: seg.edge, direction: 'added', nights: seg.nights, amountCentavos: priced.totalCentavos });

		if (!blockingReason) {
			if (isCheckedIn) {
				// Only the back edge can be "added" once checked in (front/check-in is
				// immutable — enforced by `validateRange` before this ever runs).
				const conflictRoom = await findRoomConflict(executor, bookingRoom.id, segCheckIn, segCheckOut);
				if (conflictRoom) {
					blockingReason = `Room ${conflictRoom} is booked on one or more of the added nights — resolve this before extending.`;
				}
			} else {
				const available = await roomTypeCapacityFor(hotelId, bookingRoom.roomTypeId, segCheckIn, segCheckOut);
				if (available < bookingRoom.quantity) {
					blockingReason = `Not enough rooms of this type are free for ${segCheckIn} → ${segCheckOut}.`;
				}
			}
		}
	}

	const deltaCentavos = segments.reduce(
		(sum, s) => sum + (s.direction === 'added' ? s.amountCentavos : -s.amountCentavos),
		0
	);
	return { segments, deltaCentavos, blockingReason };
}

export interface ModifyStayQuote {
	oldCheckIn: string;
	oldCheckOut: string;
	newCheckIn: string;
	newCheckOut: string;
	segments: ModifyStaySegmentQuote[];
	deltaCentavos: number;
	blockingReason: string | null;
}

/** Read-only preview for the modify dialog — never mutates anything. The commit action
 *  (`modifyBookingStay`) re-derives everything itself and is the only authority. */
export async function quoteModifyStay(
	hotelId: string,
	bookingId: string,
	newCheckIn: string,
	newCheckOut: string
): Promise<ModifyStayQuote> {
	const { booking, bookingRoom } = await loadModifiable(hotelId, bookingId, db);
	validateRange(newCheckIn, newCheckOut, booking.status === 'checked_in', booking.checkIn);

	if (newCheckIn === booking.checkIn && newCheckOut === booking.checkOut) {
		return {
			oldCheckIn: booking.checkIn,
			oldCheckOut: booking.checkOut,
			newCheckIn,
			newCheckOut,
			segments: [],
			deltaCentavos: 0,
			blockingReason: 'These are the current dates — nothing would change.'
		};
	}

	const plan = await planModification(db, hotelId, booking, bookingRoom, newCheckIn, newCheckOut);
	return { oldCheckIn: booking.checkIn, oldCheckOut: booking.checkOut, newCheckIn, newCheckOut, ...plan };
}

export interface ModifyStayResult {
	deltaCentavos: number;
	orderId: string;
}

/**
 * Applies a date change to a room booking. Re-validates and re-plans everything from
 * scratch inside the transaction (never trusts a prior `quoteModifyStay` call), posts one
 * folio charge (added nights, priced at today's rates) or credit (removed nights, prorated
 * off the booking's own total) per changed edge, updates `bookings.checkIn`/`checkOut`, and
 * — for a checked-in booking whose check-out edge changed — extends or caps the matching
 * `room_assignments` row(s) to match. No payment is taken or refunded automatically; the
 * resulting folio balance is settled the normal way.
 */
export async function modifyBookingStay(params: {
	hotelId: string;
	bookingId: string;
	newCheckIn: string;
	newCheckOut: string;
	reason: string;
	actor: SessionUser | null;
}): Promise<ModifyStayResult> {
	const { hotelId, bookingId, newCheckIn, newCheckOut, actor } = params;
	const reason = params.reason.trim();
	if (!reason) throw new ModifyStayError('Enter a reason for the date change.');

	const result = await db.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${hotelId}), hashtext(${'booking:' + bookingId}))`);

		const { booking, order, bookingRoom } = await loadModifiable(hotelId, bookingId, tx);
		validateRange(newCheckIn, newCheckOut, booking.status === 'checked_in', booking.checkIn);
		if (newCheckIn === booking.checkIn && newCheckOut === booking.checkOut) {
			throw new ModifyStayError('These are already the current dates.');
		}

		const { segments, deltaCentavos, blockingReason } = await planModification(
			tx,
			hotelId,
			booking,
			bookingRoom,
			newCheckIn,
			newCheckOut
		);
		if (blockingReason) throw new ModifyStayError(blockingReason);

		const noteParts: string[] = [];
		for (const seg of segments) {
			const folioId = await ensureFolio(tx, hotelId, { kind: 'room', bookingId });
			const sign = seg.direction === 'added' ? 1 : -1;
			const label =
				seg.direction === 'added'
					? `Stay extended — ${seg.nights[0]} to ${segCheckOutFor(seg.nights)} (+${seg.nights.length} night${seg.nights.length === 1 ? '' : 's'})`
					: `Stay shortened — removed ${seg.nights[0]} to ${segCheckOutFor(seg.nights)} (-${seg.nights.length} night${seg.nights.length === 1 ? '' : 's'}, prorated credit)`;
			await tx.insert(folioCharges).values({
				folioId,
				description: label,
				quantity: 1,
				unitPriceCentavos: sign * seg.amountCentavos,
				taxCentavos: 0,
				totalCentavos: sign * seg.amountCentavos,
				addedByUserId: actor?.id ?? null
			});
			noteParts.push(
				`${seg.direction} ${seg.nights.length} night(s) on the ${seg.edge} — ${seg.direction === 'added' ? 'charge' : 'credit'} ₱${(seg.amountCentavos / 100).toFixed(2)}`
			);
		}

		if (booking.status === 'checked_in' && newCheckOut !== booking.checkOut) {
			await tx
				.update(roomAssignments)
				.set({ checkOut: newCheckOut })
				.where(eq(roomAssignments.bookingRoomId, bookingRoom.id));
		}

		await tx
			.update(bookings)
			.set({
				checkIn: newCheckIn,
				checkOut: newCheckOut,
				totalCentavos: booking.totalCentavos + deltaCentavos,
				updatedAt: new Date()
			})
			.where(eq(bookings.id, bookingId));

		await tx.insert(bookingStatusHistory).values({
			bookingId,
			fromStatus: booking.status,
			toStatus: booking.status,
			note: `Dates changed ${booking.checkIn}→${booking.checkOut} to ${newCheckIn}→${newCheckOut} (${noteParts.join('; ')}) — ${reason}`
		});

		return { deltaCentavos, orderId: order.id };
	});

	await writeAudit({
		hotelId,
		actor,
		action: 'booking.modify_stay',
		entityType: 'booking',
		entityId: bookingId,
		after: { newCheckIn, newCheckOut, deltaCentavos: result.deltaCentavos, reason }
	});

	return result;
}
