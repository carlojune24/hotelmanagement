import { and, asc, count, eq, gt, gte, inArray, lt, lte, ne, sql } from 'drizzle-orm';
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
	roomTypes,
	rooms,
	seasonalRates
} from './db/schema/index';
import { ACTIVE_BOOKING_STATUSES, inventoryHeldUntil, roomHeldUntil } from './availability';
import { ensureFolio } from './folio';
import { writeAudit } from './audit';
import type { SessionUser } from './auth/session';
import { nightsBetween, priceStay, resolveNightlyRates } from './pricing';

export class ModifyStayError extends Error {}

export interface ModifyRoomTypeOption {
	id: string;
	name: string;
	maxOccupancy: number;
	ratePlans: { id: string; name: string; basePriceCentavos: number }[];
}

/** Every active room type + its active rate plans, for the "Modify booking" dialog's room
 *  type / rate plan pickers. Small, hotel-scoped list — no pagination needed at this scale. */
export async function listRoomTypeOptionsForModify(hotelId: string): Promise<ModifyRoomTypeOption[]> {
	const [types, plans] = await Promise.all([
		db
			.select({ id: roomTypes.id, name: roomTypes.name, maxOccupancy: roomTypes.maxOccupancy })
			.from(roomTypes)
			.where(eq(roomTypes.hotelId, hotelId))
			.orderBy(asc(roomTypes.sortOrder), asc(roomTypes.name)),
		db
			.select({
				id: ratePlans.id,
				name: ratePlans.name,
				roomTypeId: ratePlans.roomTypeId,
				basePriceCentavos: ratePlans.basePriceCentavos
			})
			.from(ratePlans)
			.where(and(eq(ratePlans.hotelId, hotelId), eq(ratePlans.isActive, true)))
			.orderBy(asc(ratePlans.name))
	]);
	return types.map((t) => ({
		...t,
		ratePlans: plans.filter((p) => p.roomTypeId === t.id).map(({ id, name, basePriceCentavos }) => ({ id, name, basePriceCentavos }))
	}));
}

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
	// Split the same way `availability.ts`'s `searchAvailability` does: a booking with no
	// physical room assigned yet blocks by its own stay dates, one already checked in/out
	// blocks by its `room_assignments` row's dates instead — otherwise an early checkout
	// (which caps the assignment's `checkOut`, never the booking's own) still reads as
	// occupying capacity through the original, never-happened checkout date.
	const [totalRows, preAssignedRows, assignedRows] = await Promise.all([
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
					inArray(bookings.status, ['pending_payment', 'confirmed']),
					lt(bookings.checkIn, checkOut),
					gt(bookings.checkOut, checkIn)
				)
			),
		db
			.select({ id: roomAssignments.id })
			.from(roomAssignments)
			.innerJoin(bookingRooms, eq(bookingRooms.id, roomAssignments.bookingRoomId))
			.innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId))
			.where(
				and(
					eq(bookings.hotelId, hotelId),
					eq(bookingRooms.roomTypeId, roomTypeId),
					inArray(bookings.status, ['checked_in', 'checked_out']),
					lt(roomAssignments.checkIn, checkOut),
					gt(inventoryHeldUntil, checkIn)
				)
			)
	]);
	const total = totalRows[0]?.n ?? 0;
	const booked =
		preAssignedRows.reduce((sum, r) => sum + r.quantity, 0) + assignedRows.length;
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
					gt(roomHeldUntil, checkIn)
				)
			)
			.limit(1);
		if (conflict.length > 0) return a.roomNumber;
	}
	return null;
}

async function loadModifiable(hotelId: string, bookingId: string, executor: Executor) {
	const [row] = await executor
		.select({ booking: bookings, order: orders, bookingRoom: bookingRooms, roomType: roomTypes })
		.from(bookings)
		.innerJoin(orders, eq(orders.id, bookings.orderId))
		.innerJoin(bookingRooms, eq(bookingRooms.bookingId, bookings.id))
		.innerJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId))
		.where(and(eq(bookings.id, bookingId), eq(bookings.hotelId, hotelId)))
		.limit(1);
	if (!row) throw new ModifyStayError('Booking not found.');
	if (row.booking.status !== 'confirmed' && row.booking.status !== 'checked_in') {
		throw new ModifyStayError(`A ${row.booking.status.replace(/_/g, ' ')} booking can't be modified.`);
	}
	if (row.order.status !== 'confirmed') {
		throw new ModifyStayError('This booking has not been paid — cannot modify it.');
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

/** Populated only when the room type or rate plan is changing — the whole stay is
 *  re-priced from scratch via `priceStay` (fees/VAT included, unlike the incremental
 *  `priceNights` the date-only path uses) rather than diffed night by night, since a
 *  different room type/rate plan has an entirely different pricing structure. */
export interface ModifyRoomChangeQuote {
	newRoomTypeId: string;
	newRatePlanId: string;
	oldTotalCentavos: number;
	newTotalCentavos: number;
}

interface PlannedModification {
	/** Populated only when room type/rate plan are unchanged and dates moved — a
	 *  per-edge night diff, same mechanism as the original date-only feature. */
	segments: ModifyStaySegmentQuote[];
	/** Populated only when room type or rate plan changed (mutually exclusive with
	 *  `segments` being non-empty — the two re-pricing modes never combine). */
	roomChange: ModifyRoomChangeQuote | null;
	/** Net folio effect: positive = additional charge, negative = credit. */
	deltaCentavos: number;
	/** Set when the requested change can't actually be honored. */
	blockingReason: string | null;
	/** The new extra-bed count, when that's what changed (never combined with a room
	 *  type/rate plan change in the same submission — see the blocking check that
	 *  enforces this). Null when extra beds weren't part of this modification. */
	extraBeds: number | null;
	/** The extra-bed portion of `deltaCentavos` alone (fee + its own VAT share) — posted
	 *  as its own folio line, distinct from whatever the room-change/segments branch posts. */
	extraBedDeltaCentavos: number;
	extraBedNote: string | null;
}

export interface ModifyBookingParams {
	newCheckIn: string;
	newCheckOut: string;
	/** Omit to leave the room type unchanged. */
	newRoomTypeId?: string;
	/** Required when `newRoomTypeId` differs from the booking's current room type;
	 *  optional otherwise (e.g. switching rate plans on the same room type). */
	newRatePlanId?: string;
	/** Omit to leave the occupancy unchanged. */
	newOccupancy?: number;
	/** Omit to leave extra beds unchanged. Allowed before or after check-in (a physical
	 *  add-on, not a room re-assignment) — but never combined with a room type/rate plan
	 *  change in the same call, see `planModification`'s own blocking check for why. */
	newExtraBeds?: number;
}

/** Shared by the read-only quote and the real commit: works out the date/room-type/
 *  occupancy change, its price/credit, and whether inventory allows it. Never mutates
 *  anything itself. */
async function planModification(
	executor: Executor,
	hotelId: string,
	booking: typeof bookings.$inferSelect,
	bookingRoom: typeof bookingRooms.$inferSelect,
	roomType: typeof roomTypes.$inferSelect,
	input: ModifyBookingParams
): Promise<PlannedModification> {
	const isCheckedIn = booking.status === 'checked_in';
	const roomTypeChanged = !!input.newRoomTypeId && input.newRoomTypeId !== bookingRoom.roomTypeId;
	const ratePlanChanged = !!input.newRatePlanId && input.newRatePlanId !== bookingRoom.ratePlanId;
	const datesChanged = input.newCheckIn !== booking.checkIn || input.newCheckOut !== booking.checkOut;
	const occupancy = input.newOccupancy ?? booking.occupancy;

	let blockingReason: string | null = null;
	let effectiveMaxOccupancy = roomType.maxOccupancy;

	// Room type is a physical-room concept — once a specific room is assigned at
	// check-in, changing type would mean moving the guest, a different (unbuilt)
	// operation. Confirmed-only, per the same posture the date-only feature already
	// takes with the check-in date itself.
	if (roomTypeChanged && isCheckedIn) {
		blockingReason = "Room type can only be changed before check-in — this guest is already checked in.";
	}

	if (!blockingReason && roomTypeChanged) {
		const [row] = await executor
			.select({ maxOccupancy: roomTypes.maxOccupancy, hotelId: roomTypes.hotelId })
			.from(roomTypes)
			.where(eq(roomTypes.id, input.newRoomTypeId!))
			.limit(1);
		if (!row || row.hotelId !== hotelId) {
			blockingReason = 'That room type was not found.';
		} else {
			effectiveMaxOccupancy = row.maxOccupancy;
		}
	}

	// Extra beds are a physical add-on, not a room re-assignment — unlike room type/rate
	// plan, allowed both before and after check-in (front desk can wheel a rollaway into
	// an already-occupied room). Validated against whichever room type is effectively in
	// force after this modification (the new one, if it's also changing).
	const extraBedsChanged = input.newExtraBeds != null && input.newExtraBeds !== bookingRoom.extraBeds;
	let extraBedDelta = 0;
	let extraBedNote: string | null = null;
	if (!blockingReason && extraBedsChanged) {
		const newExtraBeds = input.newExtraBeds!;
		if (!Number.isInteger(newExtraBeds) || newExtraBeds < 0) {
			blockingReason = 'Enter a valid number of extra beds.';
		} else if (roomTypeChanged || ratePlanChanged) {
			// Keeps the delta math honest: the room/rate-plan branch below re-prices the
			// whole stay from scratch against `booking.totalCentavos` (which already bakes
			// in whatever the *old* extra-bed fee was) — adding a second, independent
			// extra-bed delta on top of that in the same submission would double-count
			// the old fee. Two modifications, not one, when both are genuinely needed.
			blockingReason = 'Change the room type or rate plan first, then modify extra beds separately.';
		} else {
			const maxBedsTotal = roomType.extraBedAllowed ? (roomType.maxExtraBeds ?? 0) * bookingRoom.quantity : 0;
			if (newExtraBeds > maxBedsTotal) {
				blockingReason = maxBedsTotal
					? `This room type allows at most ${maxBedsTotal} extra bed${maxBedsTotal === 1 ? '' : 's'}.`
					: 'This room type does not allow extra beds.';
			} else {
				const capacity = roomType.maxOccupancy * bookingRoom.quantity + newExtraBeds * roomType.extraBedCapacity;
				if (occupancy > capacity) {
					blockingReason = `${occupancy} guests need more than ${newExtraBeds} extra bed${newExtraBeds === 1 ? '' : 's'} for this room type.`;
				} else {
					const targetRatePlanId = ratePlanChanged ? input.newRatePlanId! : bookingRoom.ratePlanId;
					const [[targetPlan], [hotelRow]] = await Promise.all([
						executor
							.select({ extraBedFeeCentavos: ratePlans.extraBedFeeCentavos })
							.from(ratePlans)
							.where(eq(ratePlans.id, targetRatePlanId))
							.limit(1),
						executor.select({ vatRateBps: hotels.vatRateBps }).from(hotels).where(eq(hotels.id, hotelId)).limit(1)
					]);
					const bedFee = targetPlan?.extraBedFeeCentavos ?? 0;
					const bedDiff = newExtraBeds - bookingRoom.extraBeds;
					const bedFeeDelta = bedDiff * bedFee;
					const bedVatDelta = Math.round((bedFeeDelta * (hotelRow?.vatRateBps ?? 0)) / 10000);
					extraBedDelta = bedFeeDelta + bedVatDelta;
					extraBedNote = `extra beds ${bookingRoom.extraBeds} → ${newExtraBeds} — ${extraBedDelta >= 0 ? 'charge' : 'credit'} ₱${(Math.abs(extraBedDelta) / 100).toFixed(2)}`;
				}
			}
		}
	}

	if (!blockingReason && (!Number.isInteger(occupancy) || occupancy < 1)) {
		blockingReason = 'Enter a valid guest count.';
	} else if (!blockingReason && occupancy > effectiveMaxOccupancy * bookingRoom.quantity && !extraBedsChanged) {
		// Skipped when extra beds are also changing this same submission — the extra-bed
		// block above already ran the real (occupancy vs. base+beds) capacity check for
		// that case; this simpler base-occupancy-only check would otherwise wrongly block
		// "3 guests + 1 extra bed" before the extra-bed logic gets a say.
		blockingReason = `This room type allows at most ${effectiveMaxOccupancy} guest${effectiveMaxOccupancy === 1 ? '' : 's'} per room.`;
	}

	let segments: ModifyStaySegmentQuote[] = [];
	let roomChange: ModifyRoomChangeQuote | null = null;
	let deltaCentavos = extraBedDelta;

	if (!blockingReason && (roomTypeChanged || ratePlanChanged)) {
		if (input.newCheckIn >= input.newCheckOut) {
			blockingReason = 'Check-out must be after check-in.';
		} else {
			const targetRoomTypeId = roomTypeChanged ? input.newRoomTypeId! : bookingRoom.roomTypeId;
			const targetRatePlanId = ratePlanChanged ? input.newRatePlanId! : bookingRoom.ratePlanId;

			const [plan] = await executor
				.select({ id: ratePlans.id, roomTypeId: ratePlans.roomTypeId })
				.from(ratePlans)
				.where(and(eq(ratePlans.id, targetRatePlanId), eq(ratePlans.hotelId, hotelId)))
				.limit(1);
			if (!plan || plan.roomTypeId !== targetRoomTypeId) {
				blockingReason = 'Pick a rate plan that belongs to the selected room type.';
			} else if (roomTypeChanged) {
				const available = await roomTypeCapacityFor(hotelId, targetRoomTypeId, input.newCheckIn, input.newCheckOut);
				if (available < bookingRoom.quantity) {
					blockingReason = `Not enough rooms of that type are free for ${input.newCheckIn} → ${input.newCheckOut}.`;
				}
			}

			if (!blockingReason) {
				const priced = await priceStay({
					hotelId,
					ratePlanId: targetRatePlanId,
					checkIn: input.newCheckIn,
					checkOut: input.newCheckOut
				});
				roomChange = {
					newRoomTypeId: targetRoomTypeId,
					newRatePlanId: targetRatePlanId,
					oldTotalCentavos: booking.totalCentavos,
					newTotalCentavos: priced.totalCentavos
				};
				deltaCentavos = priced.totalCentavos - booking.totalCentavos;
			}
		}
	} else if (!blockingReason && datesChanged) {
		const rawSegments = diffSegments(booking.checkIn, booking.checkOut, input.newCheckIn, input.newCheckOut);
		const originalNights = nightsBetween(booking.checkIn, booking.checkOut).length;

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

		// += , not = — `deltaCentavos` may already carry `extraBedDelta` from the
		// independent extra-bed check above (dates + extra beds can combine safely,
		// unlike room/rate-plan + extra beds, since this branch's delta is an incremental
		// added/removed-nights charge, never a full-total-vs-full-total re-diff).
		deltaCentavos += segments.reduce(
			(sum, s) => sum + (s.direction === 'added' ? s.amountCentavos : -s.amountCentavos),
			0
		);
	}

	return {
		segments,
		roomChange,
		deltaCentavos,
		blockingReason,
		extraBeds: extraBedsChanged && !blockingReason ? input.newExtraBeds! : null,
		extraBedDeltaCentavos: extraBedDelta,
		extraBedNote
	};
}

export interface ModifyBookingQuote {
	oldCheckIn: string;
	oldCheckOut: string;
	newCheckIn: string;
	newCheckOut: string;
	oldOccupancy: number;
	newOccupancy: number;
	segments: ModifyStaySegmentQuote[];
	roomChange: ModifyRoomChangeQuote | null;
	deltaCentavos: number;
	blockingReason: string | null;
	oldExtraBeds: number;
	newExtraBeds: number | null;
	extraBedNote: string | null;
}

function nothingChanged(
	booking: typeof bookings.$inferSelect,
	bookingRoom: typeof bookingRooms.$inferSelect,
	input: ModifyBookingParams
): boolean {
	return (
		input.newCheckIn === booking.checkIn &&
		input.newCheckOut === booking.checkOut &&
		(!input.newRoomTypeId || input.newRoomTypeId === bookingRoom.roomTypeId) &&
		(!input.newRatePlanId || input.newRatePlanId === bookingRoom.ratePlanId) &&
		(input.newOccupancy == null || input.newOccupancy === booking.occupancy) &&
		(input.newExtraBeds == null || input.newExtraBeds === bookingRoom.extraBeds)
	);
}

/** Read-only preview for the modify dialog — never mutates anything. The commit action
 *  (`modifyBookingStay`) re-derives everything itself and is the only authority. */
export async function quoteModifyStay(
	hotelId: string,
	bookingId: string,
	params: ModifyBookingParams
): Promise<ModifyBookingQuote> {
	const { booking, bookingRoom, roomType } = await loadModifiable(hotelId, bookingId, db);
	validateRange(params.newCheckIn, params.newCheckOut, booking.status === 'checked_in', booking.checkIn);

	if (nothingChanged(booking, bookingRoom, params)) {
		return {
			oldCheckIn: booking.checkIn,
			oldCheckOut: booking.checkOut,
			newCheckIn: params.newCheckIn,
			newCheckOut: params.newCheckOut,
			oldOccupancy: booking.occupancy,
			newOccupancy: booking.occupancy,
			segments: [],
			roomChange: null,
			deltaCentavos: 0,
			blockingReason:
				'Nothing would change — adjust a date, room type, rate plan, guest count, or extra beds first.',
			oldExtraBeds: bookingRoom.extraBeds,
			newExtraBeds: null,
			extraBedNote: null
		};
	}

	const plan = await planModification(db, hotelId, booking, bookingRoom, roomType, params);
	return {
		oldCheckIn: booking.checkIn,
		oldCheckOut: booking.checkOut,
		newCheckIn: params.newCheckIn,
		newCheckOut: params.newCheckOut,
		oldOccupancy: booking.occupancy,
		newOccupancy: params.newOccupancy ?? booking.occupancy,
		segments: plan.segments,
		roomChange: plan.roomChange,
		deltaCentavos: plan.deltaCentavos,
		blockingReason: plan.blockingReason,
		oldExtraBeds: bookingRoom.extraBeds,
		newExtraBeds: plan.extraBeds,
		extraBedNote: plan.extraBedNote
	};
}

export interface ModifyStayResult {
	deltaCentavos: number;
	orderId: string;
}

/**
 * Applies a date / room-type / rate-plan / occupancy change to a room booking.
 * Re-validates and re-plans everything from scratch inside the transaction (never
 * trusts a prior `quoteModifyStay` call). A date-only change posts one folio charge
 * (added nights, priced at today's rates) or credit (removed nights, prorated off the
 * booking's own total) per changed edge; a room-type/rate-plan change instead posts one
 * whole-stay re-price line. Occupancy has no pricing effect today — it's just updated.
 * No payment is taken or refunded automatically; the resulting folio balance is settled
 * the normal way.
 */
export async function modifyBookingStay(
	params: ModifyBookingParams & {
		hotelId: string;
		bookingId: string;
		reason: string;
		actor: SessionUser | null;
	}
): Promise<ModifyStayResult> {
	const { hotelId, bookingId, actor } = params;
	const reason = params.reason.trim();
	if (!reason) throw new ModifyStayError('Enter a reason for this change.');

	const result = await db.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${hotelId}), hashtext(${'booking:' + bookingId}))`);

		const { booking, order, bookingRoom, roomType } = await loadModifiable(hotelId, bookingId, tx);
		validateRange(params.newCheckIn, params.newCheckOut, booking.status === 'checked_in', booking.checkIn);
		if (nothingChanged(booking, bookingRoom, params)) {
			throw new ModifyStayError(
				'Nothing would change — adjust a date, room type, rate plan, guest count, or extra beds first.'
			);
		}

		const {
			segments,
			roomChange,
			deltaCentavos,
			blockingReason,
			extraBeds,
			extraBedDeltaCentavos,
			extraBedNote
		} = await planModification(tx, hotelId, booking, bookingRoom, roomType, params);
		if (blockingReason) throw new ModifyStayError(blockingReason);

		const noteParts: string[] = [];

		if (roomChange) {
			const [newRoomType] = await tx
				.select({ name: roomTypes.name })
				.from(roomTypes)
				.where(eq(roomTypes.id, roomChange.newRoomTypeId))
				.limit(1);
			const folioId = await ensureFolio(tx, hotelId, { kind: 'room', bookingId });
			const label = `Room type changed to ${newRoomType?.name ?? 'a different room type'} — re-priced ${params.newCheckIn} to ${params.newCheckOut}`;
			await tx.insert(folioCharges).values({
				folioId,
				description: label,
				quantity: 1,
				unitPriceCentavos: deltaCentavos,
				taxCentavos: 0,
				totalCentavos: deltaCentavos,
				addedByUserId: actor?.id ?? null
			});
			noteParts.push(
				`room type/rate plan changed — ${deltaCentavos >= 0 ? 'charge' : 'credit'} ₱${(Math.abs(deltaCentavos) / 100).toFixed(2)}`
			);
			await tx
				.update(bookingRooms)
				.set({ roomTypeId: roomChange.newRoomTypeId, ratePlanId: roomChange.newRatePlanId })
				.where(eq(bookingRooms.id, bookingRoom.id));
		} else {
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
		}

		if (extraBeds != null) {
			if (extraBedDeltaCentavos !== 0) {
				const folioId = await ensureFolio(tx, hotelId, { kind: 'room', bookingId });
				await tx.insert(folioCharges).values({
					folioId,
					description: `Extra beds ${bookingRoom.extraBeds} → ${extraBeds}`,
					quantity: 1,
					unitPriceCentavos: extraBedDeltaCentavos,
					taxCentavos: 0,
					totalCentavos: extraBedDeltaCentavos,
					addedByUserId: actor?.id ?? null
				});
			}
			noteParts.push(extraBedNote ?? `extra beds ${bookingRoom.extraBeds} → ${extraBeds}`);
			await tx.update(bookingRooms).set({ extraBeds }).where(eq(bookingRooms.id, bookingRoom.id));
		}

		if (booking.status === 'checked_in' && params.newCheckOut !== booking.checkOut) {
			await tx
				.update(roomAssignments)
				.set({ checkOut: params.newCheckOut })
				.where(eq(roomAssignments.bookingRoomId, bookingRoom.id));
		}

		const newOccupancy = params.newOccupancy ?? booking.occupancy;
		if (newOccupancy !== booking.occupancy) {
			noteParts.push(`occupancy ${booking.occupancy} → ${newOccupancy}`);
		}

		await tx
			.update(bookings)
			.set({
				checkIn: params.newCheckIn,
				checkOut: params.newCheckOut,
				occupancy: newOccupancy,
				totalCentavos: booking.totalCentavos + deltaCentavos,
				updatedAt: new Date()
			})
			.where(eq(bookings.id, bookingId));

		await tx.insert(bookingStatusHistory).values({
			bookingId,
			fromStatus: booking.status,
			toStatus: booking.status,
			note: `Booking modified (${noteParts.join('; ') || 'no financial change'}) — ${reason}`
		});

		return { deltaCentavos, orderId: order.id };
	});

	await writeAudit({
		hotelId,
		actor,
		action: 'booking.modify_stay',
		entityType: 'booking',
		entityId: bookingId,
		after: {
			newCheckIn: params.newCheckIn,
			newCheckOut: params.newCheckOut,
			newRoomTypeId: params.newRoomTypeId ?? null,
			newRatePlanId: params.newRatePlanId ?? null,
			newOccupancy: params.newOccupancy ?? null,
			newExtraBeds: params.newExtraBeds ?? null,
			deltaCentavos: result.deltaCentavos,
			reason
		}
	});

	return result;
}
