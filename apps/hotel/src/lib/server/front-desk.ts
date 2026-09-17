import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, gte, inArray, lt, lte, ne, sql } from 'drizzle-orm';
import { db } from './db/index';
import {
	bookingRooms,
	bookings,
	bookingStatusHistory,
	functionHalls,
	guests,
	hallBookings,
	hallBookingStatusHistory,
	hotels,
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
import { wallTimeToUtcMs } from './cancellation';
import { FolioError, closeFolio, getFolioDetail } from './folio';
import { getSecurityDepositForBooking } from './security-deposits';
import { recordWalkInPayment, resolvePaymentAccount, type PaymentMethod } from './finance/payments';
import { openReceivable } from './finance/receivables';
import { getBirSettings, issueInvoice } from './finance/documents';
import { priceEventHall, type PriceBreakdown } from './pricing';
import { addFlatFeeCentavos, scaleRoomPrice } from '$lib/pricing-utils';
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
 *
 * `excludeBookingId`, when given, leaves that booking's own `room_assignments` out of
 * the occupied set — needed once a room can be assigned before check-in (front-desk
 * grid pick mode): without it, a booking's own pre-assigned room would make itself
 * ineligible in its own picker.
 */
export async function listEligibleRooms(
	hotelId: string,
	roomTypeId: string,
	checkIn: string,
	checkOut: string,
	excludeBookingId?: string
) {
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
				gt(roomAssignments.checkOut, checkIn),
				...(excludeBookingId ? [ne(bookings.id, excludeBookingId)] : [])
			)
		);
	const occupied = new Set(occupiedRows.map((r) => r.roomId));

	return candidates.filter((r) => !occupied.has(r.id));
}

/**
 * Assigns specific physical rooms to a confirmed booking and flips it to
 * `checked_in`. Every condition the UI already filtered for is re-verified here
 * server-side — the form's own options are a convenience, never the real guard.
 *
 * `roomIds` may be empty (or simply ignored) when the booking already carries its
 * own `room_assignments` — the front-desk grid's pick mode now pre-assigns the
 * exact rooms staff clicked at booking-creation time (see `createWalkInBooking`),
 * so check-in for those bookings is a confirm, not a re-pick: this reuses the
 * existing rows instead of requiring (or re-inserting) a fresh selection.
 */
export async function checkInBooking(
	hotelId: string,
	bookingId: string,
	roomIds: string[],
	actor: SessionUser | null,
	/** A live camera capture of the guest's ID, already saved via `saveUpload` by the
	 *  caller (never a raw file upload — the check-in form only offers a camera capture
	 *  widget). Optional: check-in never blocks on it. */
	guestIdPhotoUrl?: string | null
): Promise<{ roomIds: string[] }> {
	const uniqueRoomIds = [...new Set(roomIds)];
	if (uniqueRoomIds.length !== roomIds.length) {
		throw new CheckInError('Each room can only be assigned once.');
	}

	const finalRoomIds = await db.transaction(async (tx) => {
		// Serializes concurrent check-in attempts on this same booking (e.g. a
		// double-submitted form) — the per-room locks below only run on the
		// "not already pre-assigned" branch, since a pre-assigned room was already
		// claimed (and locked) by its own creation transaction.
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtext(${hotelId}), hashtext(${'checkin:' + bookingId}))`
		);
		for (const roomId of [...uniqueRoomIds].sort()) {
			await tx.execute(
				sql`select pg_advisory_xact_lock(hashtext(${hotelId}), hashtext(${'room:' + roomId}))`
			);
		}

		const [booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
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

		const existingAssignments = await tx
			.select({ roomId: roomAssignments.roomId })
			.from(roomAssignments)
			.where(eq(roomAssignments.bookingRoomId, bookingRoom.id));

		let finalRoomIds: string[];
		if (existingAssignments.length >= bookingRoom.quantity) {
			// Already pre-assigned (grid pick mode at booking time) — confirm as-is,
			// nothing left to verify or insert.
			finalRoomIds = existingAssignments.map((r) => r.roomId);
		} else {
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
			finalRoomIds = uniqueRoomIds;
		}

		await tx
			.update(bookings)
			.set({
				status: 'checked_in',
				updatedAt: new Date(),
				...(guestIdPhotoUrl ? { guestIdPhotoUrl } : {})
			})
			.where(eq(bookings.id, bookingId));

		await tx.insert(bookingStatusHistory).values({
			bookingId,
			fromStatus: 'confirmed',
			toStatus: 'checked_in',
			note: guestIdPhotoUrl ? 'ID photo captured at check-in' : null
		});

		return finalRoomIds;
	});

	await writeAudit({
		hotelId,
		actor,
		action: 'booking.check_in',
		entityType: 'booking',
		entityId: bookingId,
		after: { roomIds: finalRoomIds, idPhotoCaptured: !!guestIdPhotoUrl }
	});

	return { roomIds: finalRoomIds };
}

/**
 * Captures (or replaces) a guest's ID photo for a booking that's already checked
 * in — the check-in form's own camera capture is optional, so front desk needs a
 * way to add it later without redoing check-in. Same live-camera-only source
 * (`IdCameraCapture`), just a standalone action instead of bundled into `checkIn`.
 */
export async function setGuestIdPhoto(
	hotelId: string,
	bookingId: string,
	photoUrl: string,
	actor: SessionUser | null
): Promise<void> {
	const [booking] = await db
		.select({ id: bookings.id })
		.from(bookings)
		.where(and(eq(bookings.id, bookingId), eq(bookings.hotelId, hotelId)))
		.limit(1);
	if (!booking) throw new CheckInError('Booking not found.');

	await db
		.update(bookings)
		.set({ guestIdPhotoUrl: photoUrl, updatedAt: new Date() })
		.where(eq(bookings.id, bookingId));

	await writeAudit({
		hotelId,
		actor,
		action: 'booking.id_photo_captured',
		entityType: 'booking',
		entityId: bookingId,
		after: { idPhotoCaptured: true }
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
	/** The hotel's daily `checkOutTime` policy applied to this room's own checkout
	 *  date (`checkOut`), resolved to a UTC instant — when the front-desk panel's
	 *  countdown actually counts down to. Not "midnight of the checkout date". */
	checkoutAtIso: string;
}

/** A confirmed booking arriving `businessDate` — either still unassigned (attributed to
 *  its room type on the grid) or already pre-assigned a specific room (grid pick mode
 *  at booking time), in which case it's attributed to that one room instead. */
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
	/** Staff-only identifier color from `roomTypes.colorHex`, or null if unset. */
	roomTypeColor: string | null;
	status: RoomGridStatus;
	/** `rooms.notes` — only meaningful (and only shown) for `ooo`. */
	notes: string | null;
	occupant: RoomGridOccupant | null;
	/** Non-empty only when `status === 'reserved'`. If this exact room was pre-assigned
	 *  at booking time, just that one arrival; otherwise every unassigned confirmed
	 *  arrival of this room's type (no specific room known yet). */
	expectedArrivals: RoomGridArrival[];
}

/**
 * The front desk's room-status board for `businessDate`: every physical room,
 * colored by what's actually happening in it right now, plus the flat
 * arrivals/departures lists the side rail's default view uses. Unlike the
 * booking-centric list this replaced, this starts from `rooms` so a genuinely
 * vacant room (no booking at all) still shows up — the whole point of a rack
 * view. A confirmed arrival's "reserved" flag points at its *room type* (every
 * unassigned arrival of that type) unless the front-desk grid's pick mode
 * already pre-assigned it a specific `room_assignments` row at booking time —
 * in that case the exact room shows reserved for that one guest instead.
 */
export async function getRoomStatusGrid(
	hotelId: string,
	businessDate: string,
	/** The hotel's own daily checkout-time policy + IANA timezone (`hotels.checkOutTime`/
	 *  `hotels.timezone`) — needed only to resolve each occupied room's `checkoutAtIso`. */
	checkOutTime: string,
	timezone: string
): Promise<{
	cells: RoomGridCell[];
	arrivals: RoomGridArrival[];
	departures: RoomGridDeparture[];
}> {
	const roomRows = await db
		.select({
			roomId: rooms.id,
			roomNumber: rooms.roomNumber,
			floor: rooms.floor,
			notes: rooms.notes,
			operationalStatus: rooms.operationalStatus,
			roomTypeId: rooms.roomTypeId,
			roomTypeName: roomTypes.name,
			roomTypeColor: roomTypes.colorHex
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
				// `gte`, not `gt` — a room's actual checkout morning (`checkOut ===
				// businessDate`) must still count as occupied here (then get flagged
				// "departing" just below) until staff actually run `checkOutBooking`.
				// A strict `gt` would drop the room out of this set entirely on its own
				// checkout day, before check-out ever happens — silently reading as
				// Vacant on the grid despite the guest still being in-house, and making
				// the "departing" branch just below unreachable dead code.
				gte(roomAssignments.checkOut, businessDate)
			)
		);

	const arrivalRows = await db
		.select({
			roomTypeId: bookingRooms.roomTypeId,
			roomTypeName: roomTypes.name,
			bookingId: bookings.id,
			guestName: guests.fullName,
			orderId: orders.id,
			assignmentId: roomAssignments.id,
			assignedRoomId: roomAssignments.roomId
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
	// A confirmed arrival whose room was already pre-assigned (grid pick mode at
	// booking time, not check-in) — attributed to its exact room, not its type.
	const assignedArrivals = arrivalRows.filter((r) => r.assignmentId != null);

	const orderIds = [
		...new Set([
			...occupantRows.map((r) => r.orderId),
			...unassignedArrivals.map((r) => r.orderId),
			...assignedArrivals.map((r) => r.orderId)
		])
	];
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
	// Pre-assigned arrivals also feed the flat `arrivals` list (the rail's default
	// view lists every arrival regardless of whether it has a room yet).
	for (const r of assignedArrivals) {
		arrivals.push({
			bookingId: r.bookingId,
			guestName: r.guestName,
			roomTypeName: r.roomTypeName,
			channel: channelByOrder.get(r.orderId) ?? 'paymongo'
		});
	}

	const reservedByRoomId = new Map<string, RoomGridArrival>(
		assignedArrivals.map((r) => [
			r.assignedRoomId!,
			{
				bookingId: r.bookingId,
				guestName: r.guestName,
				roomTypeName: r.roomTypeName,
				channel: channelByOrder.get(r.orderId) ?? 'paymongo'
			}
		])
	);

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
				channel: channelByOrder.get(occ.orderId) ?? 'paymongo',
				checkoutAtIso: new Date(
					wallTimeToUtcMs(occ.assignmentCheckOut, checkOutTime, timezone)
				).toISOString()
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
		} else if (reservedByRoomId.has(room.roomId)) {
			status = 'reserved';
		} else if (arrivalsByRoomType.has(room.roomTypeId)) {
			status = 'reserved';
		} else {
			status = 'vacant';
		}

		const reservedArrival = reservedByRoomId.get(room.roomId);
		return {
			roomId: room.roomId,
			roomNumber: room.roomNumber,
			floor: room.floor,
			roomTypeId: room.roomTypeId,
			roomTypeName: room.roomTypeName,
			roomTypeColor: room.roomTypeColor,
			status,
			notes: room.notes,
			occupant,
			expectedArrivals:
				status !== 'reserved'
					? []
					: reservedArrival
						? [reservedArrival]
						: (arrivalsByRoomType.get(room.roomTypeId) ?? [])
		};
	});

	return { cells, arrivals, departures };
}

export class WalkInError extends Error {}

/** One room-type/rate-plan line in a walk-in sale — a walk-in cart can carry several
 *  of these (different room types, different quantities) settled together in one
 *  payment. Each line keeps its own dates/occupancy so this shape can stand on its
 *  own (matching `roomItemSchema` in `(guest)/details/+page.server.ts`), even though
 *  today's front-desk UI only ever submits identical dates/occupancy across lines. */
export interface WalkInRoomItem {
	roomTypeId: string;
	ratePlanId: string;
	checkIn: string;
	checkOut: string;
	occupancy: number;
	roomCount: number;
	/** Specific physical rooms staff clicked on the front-desk grid (pick mode),
	 *  length always equal to `roomCount` when present. `createWalkInBooking`
	 *  re-verifies each is still free and assigns it immediately — see that
	 *  function's own doc comment. Absent for lines built from the date-search
	 *  fallback, where no specific room is known at booking time. */
	roomIds?: string[];
}

/** Distinct, sorted advisory-lock keys for every room type — and, for a pre-assigned
 *  line, every specific room — a walk-in cart touches, sorted so two concurrent sales
 *  touching the same rooms in a different order can't deadlock each other. Room-only
 *  mirror of `(guest)/details/+page.server.ts`'s `lockKeysFor` — a walk-in cart never
 *  carries hall lines (those go through `createWalkInHallBooking`). */
function lockKeysForRooms(items: WalkInRoomItem[]): string[] {
	const keys = new Set<string>();
	for (const item of items) {
		keys.add(`room:${item.roomTypeId}`);
		for (const roomId of item.roomIds ?? []) keys.add(`room-id:${roomId}`);
	}
	return [...keys].sort();
}

/** One room the front-desk grid's pick mode is checking — keyed by the client's own
 *  correlation id (the physical room tile's `roomId`) so results can be matched back
 *  to the tile that produced them without relying on array order. */
export interface WalkInAvailabilityCheckItem {
	key: string;
	roomTypeId: string;
	checkIn: string;
	checkOut: string;
	occupancy: number;
	roomCount: number;
}

export interface WalkInAvailabilityCheckResult {
	key: string;
	available: boolean;
	reason?: string;
	roomTypeName?: string;
	availableRooms?: number;
	extraBedsNeeded?: number;
	ratePlans?: Array<{
		id: string;
		name: string;
		price: PriceBreakdown;
		extraBedFeeCentavos: number | null;
	}>;
}

/**
 * Read-only availability + price check for the front-desk grid's pick mode — a staff
 * member toggle-selects room tiles before ever choosing a rate plan, so this resolves
 * "is this room type actually bookable for the dates picked, and what rate plans does
 * it offer" per selection, without locking or writing anything. Purely a UX preview:
 * `createWalkInBooking` re-verifies every line again itself inside its own transaction
 * at submit time, exactly like every other "never trust the preview" check in this app.
 */
export async function previewWalkInAvailability(
	hotelId: string,
	items: WalkInAvailabilityCheckItem[]
): Promise<WalkInAvailabilityCheckResult[]> {
	const results: WalkInAvailabilityCheckResult[] = [];
	for (const item of items) {
		if (item.checkIn >= item.checkOut) {
			results.push({
				key: item.key,
				available: false,
				reason: 'Check-out must be after check-in.'
			});
			continue;
		}
		const available = await getAvailableRoomType({
			hotelId,
			checkIn: item.checkIn,
			checkOut: item.checkOut,
			occupancy: item.occupancy,
			roomCount: item.roomCount,
			roomTypeId: item.roomTypeId
		});
		if (!available || available.ratePlans.length === 0) {
			results.push({
				key: item.key,
				available: false,
				reason: 'Not available for these dates.'
			});
			continue;
		}
		results.push({
			key: item.key,
			available: true,
			roomTypeName: available.name,
			availableRooms: available.availableRooms,
			extraBedsNeeded: available.extraBedsNeeded,
			ratePlans: available.ratePlans.map((p) => ({
				id: p.id,
				name: p.name,
				price: p.price,
				extraBedFeeCentavos: p.extraBedFeeCentavos
			}))
		});
	}
	return results;
}

/**
 * Creates a guest + order + one-or-more bookings directly as `confirmed`, with a
 * single `cash`/etc. payment row for the combined total — a walk-in is settled at
 * the desk on the spot, not through the guest-facing PayMongo checkout
 * `(guest)/details`'s `createOrder` action drives. Re-verifies availability and
 * re-prices every line server-side exactly like that action does; deliberately
 * mirrors its lock/verify/insert loop rather than reusing it directly, since a
 * walk-in skips the pending-payment step and cart entirely and settles in one shot.
 *
 * Because `payments` rows are keyed by `orderId` (not per-booking) and
 * `getFolioDetail` sums every payment on an order against each booking's own
 * folio, a multi-line walk-in's single combined payment will show as the full
 * paid amount on *every* line's individual folio — a pre-existing quirk of the
 * single-payment-per-order design, already present for multi-room online orders.
 */
export interface WalkInPaymentInput {
	method: PaymentMethod;
	tenderedCentavos?: number | null;
	referenceNo?: string | null;
	bankName?: string | null;
	chequeDate?: string | null;
}

export async function createWalkInBooking(params: {
	hotelId: string;
	businessDate: string;
	guest: { fullName: string; email: string; phone: string | null; specialRequests: string | null };
	rooms: WalkInRoomItem[];
	/** How the full total is settled at the desk. Defaults to cash. */
	payment?: WalkInPaymentInput;
	actor: SessionUser | null;
}): Promise<{ bookingIds: string[] }> {
	// Destructured as `roomItems`, not `rooms` — this function needs the actual
	// `rooms` table (physical rooms) for the pre-assignment checks below, and
	// shadowing it with the cart's room *lines* would silently query the wrong
	// thing (a real bug this once was, caught by `npm run check`).
	const { hotelId, businessDate, guest, rooms: roomItems, actor } = params;
	const payment: WalkInPaymentInput = params.payment ?? { method: 'cash' };
	if (roomItems.length === 0) {
		throw new WalkInError('Add at least one room before creating the booking.');
	}
	for (const item of roomItems) {
		if (item.checkIn >= item.checkOut) throw new WalkInError('Check-out must be after check-in.');
	}

	// Resolve the receiving account (and open shift for cash) before the tx —
	// `resolvePaymentAccount` throws a FinanceError the action turns into `walkInError`.
	const { cashAccountId, shiftId } = await resolvePaymentAccount(hotelId, payment.method);

	const { bookingIds, totalPaidCentavos } = await db.transaction(async (tx) => {
		for (const key of lockKeysForRooms(roomItems)) {
			await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${hotelId}), hashtext(${key}))`);
		}

		const [hotelRow] = await tx
			.select({ vatRateBps: hotels.vatRateBps })
			.from(hotels)
			.where(eq(hotels.id, hotelId))
			.limit(1);
		const vatRateBps = hotelRow?.vatRateBps ?? 0;

		let subtotalCentavos = 0;
		let feesCentavos = 0;
		let vatCentavos = 0;
		let totalCentavos = 0;
		const lines: Array<{
			item: WalkInRoomItem;
			price: PriceBreakdown;
			extraBeds: number;
			roomIds?: string[];
		}> = [];

		// Re-verify availability and re-price every line server-side, inside the
		// lock — never trust client-supplied amounts, same posture as the
		// single-line version this loop replaces.
		for (const item of roomItems) {
			const available = await getAvailableRoomType({
				hotelId,
				checkIn: item.checkIn,
				checkOut: item.checkOut,
				occupancy: item.occupancy,
				roomCount: item.roomCount,
				roomTypeId: item.roomTypeId
			});
			const plan = available?.ratePlans.find((p) => p.id === item.ratePlanId);
			if (!available || !plan) {
				throw new WalkInError('One of the selected rooms is no longer available for these dates.');
			}
			// Extra beds needed is re-derived here from the room type's own capacity/policy
			// (`getAvailableRoomType` already ran the occupancy solver) rather than trusting
			// anything the client sent — same "never trust the preview" posture the rest of
			// this file already takes with prices and room selections.
			const extraBeds = available.extraBedsNeeded;
			let price = scaleRoomPrice(plan.price, item.roomCount);
			if (extraBeds > 0 && plan.extraBedFeeCentavos) {
				price = addFlatFeeCentavos(
					price,
					`Extra bed × ${extraBeds}`,
					extraBeds * plan.extraBedFeeCentavos,
					vatRateBps
				);
			}
			const lineFees = price.fees.reduce((sum, f) => sum + f.amountCentavos, 0);
			subtotalCentavos += price.subtotalCentavos;
			feesCentavos += lineFees;
			vatCentavos += price.vatCentavos;
			totalCentavos += price.totalCentavos;

			// A line from the grid's pick mode carries the exact rooms staff clicked —
			// `getAvailableRoomType` above only confirmed the room *type* has enough
			// free quantity, so still verify these specific physical rooms are free
			// (still active/available, not already assigned to another active-status
			// booking for an overlapping range) before claiming them.
			let roomIds: string[] | undefined;
			if (item.roomIds && item.roomIds.length > 0) {
				const uniqueRoomIds = [...new Set(item.roomIds)];
				if (
					uniqueRoomIds.length !== item.roomIds.length ||
					uniqueRoomIds.length !== item.roomCount
				) {
					throw new WalkInError('Selected room count does not match.');
				}
				const roomRows = await tx
					.select({ id: rooms.id })
					.from(rooms)
					.where(
						and(
							inArray(rooms.id, uniqueRoomIds),
							eq(rooms.hotelId, hotelId),
							eq(rooms.roomTypeId, item.roomTypeId),
							eq(rooms.isActive, true),
							eq(rooms.operationalStatus, 'available')
						)
					);
				if (roomRows.length !== uniqueRoomIds.length) {
					throw new WalkInError('One or more selected rooms are no longer available.');
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
							lt(roomAssignments.checkIn, item.checkOut),
							gt(roomAssignments.checkOut, item.checkIn)
						)
					);
				if (occupiedRows.length > 0) {
					throw new WalkInError('One or more selected rooms were just taken — pick again.');
				}
				roomIds = uniqueRoomIds;
			}

			lines.push({ item, price, extraBeds, roomIds });
		}

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
				subtotalCentavos,
				feesCentavos,
				vatCentavos,
				totalCentavos,
				accessToken: randomUUID()
			})
			.returning({ id: orders.id });

		await tx.insert(orderStatusHistory).values({
			orderId: order!.id,
			fromStatus: null,
			toStatus: 'confirmed',
			note: 'Walk-in — settled at front desk'
		});

		const bookingIds: string[] = [];
		for (const { item, price, extraBeds, roomIds } of lines) {
			const lineFees = price.fees.reduce((sum, f) => sum + f.amountCentavos, 0);
			const [booking] = await tx
				.insert(bookings)
				.values({
					hotelId,
					orderId: order!.id,
					checkIn: item.checkIn,
					checkOut: item.checkOut,
					occupancy: item.occupancy,
					status: 'confirmed',
					subtotalCentavos: price.subtotalCentavos,
					feesCentavos: lineFees,
					vatCentavos: price.vatCentavos,
					totalCentavos: price.totalCentavos
				})
				.returning({ id: bookings.id });

			const [bookingRoom] = await tx
				.insert(bookingRooms)
				.values({
					bookingId: booking!.id,
					roomTypeId: item.roomTypeId,
					ratePlanId: item.ratePlanId,
					quantity: item.roomCount,
					extraBeds
				})
				.returning({ id: bookingRooms.id });

			// Pre-assign the exact rooms staff clicked on the grid — already verified
			// free just above, inside this same locked transaction. Unlike every other
			// `room_assignments` insert in this file (which only happens at check-in),
			// this one exists from the moment the booking is created; `checkInBooking`
			// knows to reuse rather than re-insert these.
			if (roomIds && roomIds.length > 0) {
				await tx.insert(roomAssignments).values(
					roomIds.map((roomId) => ({
						bookingRoomId: bookingRoom!.id,
						roomId,
						checkIn: item.checkIn,
						checkOut: item.checkOut
					}))
				);
			}

			await tx.insert(bookingStatusHistory).values({
				bookingId: booking!.id,
				fromStatus: null,
				toStatus: 'confirmed',
				note:
					extraBeds > 0 ? `Walk-in booking — ${extraBeds} extra bed(s) added` : 'Walk-in booking'
			});

			bookingIds.push(booking!.id);
		}

		// Full settlement + its cash-ledger movement, in the same transaction — one
		// payment for the whole sale, attached to the first line's booking/folio.
		await recordWalkInPayment(tx, {
			hotelId,
			orderId: order!.id,
			target: { kind: 'room', bookingId: bookingIds[0]! },
			method: payment.method,
			amountCentavos: totalCentavos,
			tenderedCentavos: payment.tenderedCentavos ?? null,
			referenceNo: payment.referenceNo ?? null,
			bankName: payment.bankName ?? null,
			chequeDate: payment.chequeDate ?? null,
			cashAccountId,
			shiftId,
			businessDate,
			guestName: guest.fullName.trim(),
			actor
		});

		return { bookingIds, totalPaidCentavos: totalCentavos };
	});

	await writeAudit({
		hotelId,
		actor,
		action: 'booking.walk_in',
		entityType: 'booking',
		entityId: bookingIds[0]!,
		after: {
			rooms: roomItems,
			bookingIds,
			paymentMethod: payment.method,
			amountCentavos: totalPaidCentavos,
			tenderedCentavos: payment.tenderedCentavos ?? null
		}
	});

	return { bookingIds };
}

export class CheckOutError extends Error {}

/**
 * Charge-to-company details for a checkout that leaves a balance. Only a
 * `hotel_admin` may pass this (enforced in the route action); it moves the
 * outstanding balance into the Finance city ledger instead of blocking checkout.
 */
export interface CityLedgerHandoff {
	billToName: string;
	billToCompany?: string | null;
	referenceNo?: string | null;
	notes?: string | null;
}

/** Flips a checked-in booking to `checked_out` — refuses while the booking's folio (see
 *  `lib/server/folio.ts`) still carries an outstanding balance, unless `cityLedger` is
 *  given, in which case the balance is moved to Accounts Receivable and checkout proceeds.
 *  No invoice/OR generation yet (see docs/TODO.md). */
export async function checkOutBooking(
	hotelId: string,
	bookingId: string,
	businessDate: string,
	actor: SessionUser | null,
	cityLedger?: CityLedgerHandoff
): Promise<void> {
	// A held deposit must be explicitly settled (released or applied to damage) before
	// checkout — never silently left open, and never routable to the city ledger, since
	// it's collateral the hotel is holding, not a charge the guest still owes.
	const securityDeposit = await getSecurityDepositForBooking(hotelId, bookingId);
	if (securityDeposit?.status === 'held') {
		throw new CheckOutError(
			`Settle the ₱${(securityDeposit.amountCentavos / 100).toFixed(2)} security deposit before checking out.`
		);
	}

	let folio;
	try {
		folio = await getFolioDetail(hotelId, { kind: 'room', bookingId });
	} catch (e) {
		if (e instanceof FolioError) throw new CheckOutError(e.message);
		throw e;
	}
	if (folio.balanceCentavos > 0) {
		if (!cityLedger) {
			throw new CheckOutError(
				`Settle the outstanding balance of ₱${(folio.balanceCentavos / 100).toFixed(2)} before checking out.`
			);
		}
		try {
			await openReceivable({
				hotelId,
				target: { kind: 'room', bookingId },
				billToName: cityLedger.billToName,
				billToCompany: cityLedger.billToCompany ?? null,
				referenceNo: cityLedger.referenceNo ?? null,
				notes: cityLedger.notes ?? null,
				actor
			});
		} catch (e) {
			throw new CheckOutError(
				e instanceof Error ? e.message : 'Could not move the balance to the city ledger.'
			);
		}
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
					.where(
						and(
							eq(roomAssignments.bookingRoomId, bookingRoom.id),
							gt(roomAssignments.checkOut, businessDate)
						)
					);
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

	// Issue the guest's Invoice on check-out. Non-fatal: a missing/exhausted BIR
	// series is logged for staff to resolve in Finance → BIR; the Invoice issues
	// on first print otherwise.
	const bir = await getBirSettings(hotelId).catch(() => null);
	if (bir?.autoIssueInvoiceOnCheckout) {
		try {
			await issueInvoice(hotelId, { kind: 'room', bookingId }, actor);
		} catch (e) {
			console.warn('checkOutBooking: could not issue invoice', bookingId, e);
		}
	}
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
export async function getHallStatusBoard(
	hotelId: string,
	businessDate: string
): Promise<HallGridCell[]> {
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
	for (const list of eventsByHall.values())
		list.sort((a, b) => a.startTime.localeCompare(b.startTime));

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
	businessDate: string;
	guest: { fullName: string; email: string; phone: string | null; specialRequests: string | null };
	functionHallId: string;
	eventDate: string;
	startTime: string;
	endTime: string;
	eventType: string;
	guestCount: number;
	payment?: WalkInPaymentInput;
	actor: SessionUser | null;
}): Promise<{ hallBookingId: string }> {
	const {
		hotelId,
		businessDate,
		guest,
		functionHallId,
		eventDate,
		startTime,
		endTime,
		eventType,
		guestCount,
		actor
	} = params;
	const payment: WalkInPaymentInput = params.payment ?? { method: 'cash' };

	const { cashAccountId, shiftId } = await resolvePaymentAccount(hotelId, payment.method);

	const { hallBookingId, totalPaidCentavos } = await db.transaction(async (tx) => {
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtext(${hotelId}), hashtext(${'hall:' + functionHallId + ':' + eventDate}))`
		);

		const available = await checkHallAvailability({
			hotelId,
			functionHallId,
			eventDate,
			startTime,
			endTime
		});
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

		await recordWalkInPayment(tx, {
			hotelId,
			orderId: order!.id,
			target: { kind: 'hall', hallBookingId: hallBooking!.id },
			method: payment.method,
			amountCentavos: price.totalCentavos,
			tenderedCentavos: payment.tenderedCentavos ?? null,
			referenceNo: payment.referenceNo ?? null,
			bankName: payment.bankName ?? null,
			chequeDate: payment.chequeDate ?? null,
			cashAccountId,
			shiftId,
			businessDate,
			guestName: guest.fullName.trim(),
			actor
		});

		return { hallBookingId: hallBooking!.id, totalPaidCentavos: price.totalCentavos };
	});

	await writeAudit({
		hotelId,
		actor,
		action: 'hall_booking.walk_in',
		entityType: 'hall_booking',
		entityId: hallBookingId,
		after: {
			functionHallId,
			eventDate,
			startTime,
			endTime,
			eventType,
			guestCount,
			paymentMethod: payment.method,
			amountCentavos: totalPaidCentavos,
			tenderedCentavos: payment.tenderedCentavos ?? null
		}
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

		await tx
			.update(hallBookings)
			.set({ status: 'completed' })
			.where(eq(hallBookings.id, hallBookingId));

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
