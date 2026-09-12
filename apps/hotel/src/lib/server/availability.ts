import { and, asc, eq, count, gt, gte, inArray, lt } from 'drizzle-orm';
import { db } from './db/index';
import {
	amenities,
	bookingRooms,
	bookings,
	cancellationPolicies,
	guests,
	hotelAmenities,
	orders,
	ratePlans,
	roomTypeAmenities,
	roomTypes,
	rooms,
	type BedConfigEntry,
	type RoomPhoto
} from './db/schema/index';
import { nightsBetween, priceStay, type PriceBreakdown } from './pricing';

export interface AmenityHighlight {
	name: string;
	icon: string | null;
}

/** One amenity in a room type's full (uncapped) amenity list, grouped by category for the room details dialog. */
export interface AmenityDetail {
	name: string;
	icon: string | null;
	/** Raw `amenity_category` enum value — labelled client-side via `$lib/amenity-categories`. */
	category: string;
}

/** Free-cancellation terms for a rate plan, or null if it has no cancellation policy attached (treated as non-refundable). */
export interface CancellationTerms {
	freeCancelHours: number | null;
	penaltyType: 'percentage_of_total' | 'first_night' | 'full_amount';
}

export interface AvailableRatePlan {
	id: string;
	name: string;
	description: string | null;
	inclusions: string[];
	minStayNights: number | null;
	maxStayNights: number | null;
	cancellation: CancellationTerms | null;
	price: PriceBreakdown;
}

export interface AvailableRoomType {
	id: string;
	name: string;
	code: string | null;
	category: string | null;
	description: string | null;
	baseOccupancy: number;
	maxOccupancy: number;
	availableRooms: number;
	photos: RoomPhoto[];
	sizeSqm: number | null;
	bedConfiguration: BedConfigEntry[];
	bedFlexible: boolean;
	flexibilityNote: string | null;
	viewType: string | null;
	wheelchairAccessible: boolean;
	rollInShower: boolean;
	grabBars: boolean;
	smokingPolicy: 'non_smoking' | 'smoking_allowed';
	highlightedAmenities: AmenityHighlight[];
	/** Full, uncapped amenity list grouped-ready for the room details dialog — see `room_type_amenities.isHighlighted`'s own comment ("the rest sit behind 'See all'"). */
	amenities: AmenityDetail[];
	ratePlans: AvailableRatePlan[];
}

/** Fetches up to 4 highlighted amenities per room type for a hotel, keyed by room type id. Shared by both the dated and undated room listings. */
async function loadHighlightedAmenitiesByType(
	hotelId: string
): Promise<Map<string, AmenityHighlight[]>> {
	const rows = await db
		.select({
			roomTypeId: roomTypeAmenities.roomTypeId,
			name: amenities.name,
			icon: amenities.icon
		})
		.from(roomTypeAmenities)
		.innerJoin(amenities, eq(amenities.id, roomTypeAmenities.amenityId))
		.where(and(eq(roomTypeAmenities.hotelId, hotelId), eq(roomTypeAmenities.isHighlighted, true)))
		.orderBy(asc(roomTypeAmenities.sortOrder));
	const byType = new Map<string, AmenityHighlight[]>();
	for (const r of rows) {
		const list = byType.get(r.roomTypeId) ?? [];
		if (list.length < 4) list.push({ name: r.name, icon: r.icon });
		byType.set(r.roomTypeId, list);
	}
	return byType;
}

/** Fetches every amenity per room type (no highlight filter, no cap), with category — for the room details dialog's full grouped list. Keyed by room type id. */
async function loadAllAmenitiesByType(hotelId: string): Promise<Map<string, AmenityDetail[]>> {
	const rows = await db
		.select({
			roomTypeId: roomTypeAmenities.roomTypeId,
			name: amenities.name,
			icon: amenities.icon,
			category: amenities.category
		})
		.from(roomTypeAmenities)
		.innerJoin(amenities, eq(amenities.id, roomTypeAmenities.amenityId))
		.where(eq(roomTypeAmenities.hotelId, hotelId))
		.orderBy(asc(roomTypeAmenities.sortOrder));
	const byType = new Map<string, AmenityDetail[]>();
	for (const r of rows) {
		const list = byType.get(r.roomTypeId) ?? [];
		list.push({ name: r.name, icon: r.icon, category: r.category });
		byType.set(r.roomTypeId, list);
	}
	return byType;
}

/** Booking statuses that occupy a room for its date range (exclude cancelled/no_show).
 *  Exported for `lib/server/front-desk.ts`'s physical-room overlap check — same
 *  definition of "occupies the room," just scoped to one room instead of a type count. */
export const ACTIVE_BOOKING_STATUSES = [
	'pending_payment',
	'confirmed',
	'checked_in',
	'checked_out'
] as const;

/**
 * Date range + occupancy → available room types with a full price breakdown per
 * rate plan. Reused by the public booking flow and front desk.
 *
 * `availableRooms` is active rooms of the type minus rooms already booked (in an
 * active status) for any overlapping night in `[checkIn, checkOut)`; a room type
 * is only returned if `availableRooms >= roomCount`.
 */
export async function searchAvailability(params: {
	hotelId: string;
	checkIn: string;
	checkOut: string;
	occupancy: number;
	/** How many rooms of a type the guest wants — a type only qualifies if it has at least this
	 *  many rooms free. Defaults to 1 so existing callers are unaffected. */
	roomCount?: number;
	/** Restrict to room types flagged wheelchair-accessible. */
	accessibleOnly?: boolean;
}): Promise<AvailableRoomType[]> {
	const { hotelId, checkIn, checkOut, occupancy, roomCount = 1, accessibleOnly } = params;
	if (checkIn >= checkOut) throw new Error('checkOut must be after checkIn');
	const stayNights = nightsBetween(checkIn, checkOut).length;

	const types = await db
		.select()
		.from(roomTypes)
		.where(
			and(
				eq(roomTypes.hotelId, hotelId),
				gte(roomTypes.maxOccupancy, occupancy),
				accessibleOnly ? eq(roomTypes.wheelchairAccessible, true) : undefined
			)
		);
	if (types.length === 0) return [];

	const roomCounts = await db
		.select({ roomTypeId: rooms.roomTypeId, n: count() })
		.from(rooms)
		.where(
			and(
				eq(rooms.hotelId, hotelId),
				eq(rooms.isActive, true),
				eq(rooms.operationalStatus, 'available')
			)
		)
		.groupBy(rooms.roomTypeId);
	const countByType = new Map(roomCounts.map((r) => [r.roomTypeId, r.n]));

	// Rooms already booked (active statuses) for any night overlapping [checkIn, checkOut).
	const bookedRows = await db
		.select({ roomTypeId: bookingRooms.roomTypeId, quantity: bookingRooms.quantity })
		.from(bookingRooms)
		.innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId))
		.where(
			and(
				eq(bookings.hotelId, hotelId),
				inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES]),
				lt(bookings.checkIn, checkOut),
				gt(bookings.checkOut, checkIn)
			)
		);
	const bookedByType = new Map<string, number>();
	for (const row of bookedRows) {
		bookedByType.set(row.roomTypeId, (bookedByType.get(row.roomTypeId) ?? 0) + row.quantity);
	}

	const available = types
		.map((t) => ({
			type: t,
			availableRooms: (countByType.get(t.id) ?? 0) - (bookedByType.get(t.id) ?? 0)
		}))
		.filter((t) => t.availableRooms >= roomCount);
	if (available.length === 0) return [];

	const [plansByType, cancellationByPlan, highlightsByType, amenitiesByType] = await Promise.all([
		db
			.select()
			.from(ratePlans)
			.where(and(eq(ratePlans.hotelId, hotelId), eq(ratePlans.isActive, true))),
		db
			.select({
				ratePlanId: ratePlans.id,
				freeCancelHours: cancellationPolicies.freeCancelHours,
				penaltyType: cancellationPolicies.penaltyType
			})
			.from(ratePlans)
			.innerJoin(cancellationPolicies, eq(cancellationPolicies.id, ratePlans.cancellationPolicyId))
			.where(eq(ratePlans.hotelId, hotelId))
			.then((rows) => new Map(rows.map((r) => [r.ratePlanId, r]))),
		loadHighlightedAmenitiesByType(hotelId),
		loadAllAmenitiesByType(hotelId)
	]);

	const results: AvailableRoomType[] = [];
	for (const { type, availableRooms } of available) {
		const plans = plansByType.filter(
			(p) =>
				p.roomTypeId === type.id &&
				(p.minStayNights == null || stayNights >= p.minStayNights) &&
				(p.maxStayNights == null || stayNights <= p.maxStayNights)
		);
		if (plans.length === 0) continue;

		const ratePlansOut: AvailableRatePlan[] = [];
		for (const plan of plans) {
			const price = await priceStay({ hotelId, ratePlanId: plan.id, checkIn, checkOut });
			const cancellation = cancellationByPlan.get(plan.id);
			ratePlansOut.push({
				id: plan.id,
				name: plan.name,
				description: plan.description,
				inclusions: plan.inclusions,
				minStayNights: plan.minStayNights,
				maxStayNights: plan.maxStayNights,
				cancellation: cancellation
					? { freeCancelHours: cancellation.freeCancelHours, penaltyType: cancellation.penaltyType }
					: null,
				price
			});
		}

		results.push({
			id: type.id,
			name: type.name,
			code: type.code,
			category: type.category,
			description: type.description,
			baseOccupancy: type.baseOccupancy,
			maxOccupancy: type.maxOccupancy,
			availableRooms,
			photos: (type.photos as RoomPhoto[]) ?? [],
			sizeSqm: type.sizeSqm,
			bedConfiguration: (type.bedConfiguration as BedConfigEntry[]) ?? [],
			bedFlexible: type.bedFlexible,
			flexibilityNote: type.flexibilityNote,
			viewType: type.viewType,
			wheelchairAccessible: type.wheelchairAccessible,
			rollInShower: type.rollInShower,
			grabBars: type.grabBars,
			smokingPolicy: type.smokingPolicy,
			highlightedAmenities: highlightsByType.get(type.id) ?? [],
			amenities: amenitiesByType.get(type.id) ?? [],
			ratePlans: ratePlansOut
		});
	}

	return results;
}

export interface BrowsableRoomType {
	id: string;
	name: string;
	category: string | null;
	description: string | null;
	photos: RoomPhoto[];
	baseOccupancy: number;
	maxOccupancy: number;
	sizeSqm: number | null;
	bedConfiguration: BedConfigEntry[];
	bedFlexible: boolean;
	flexibilityNote: string | null;
	viewType: string | null;
	wheelchairAccessible: boolean;
	rollInShower: boolean;
	grabBars: boolean;
	smokingPolicy: 'non_smoking' | 'smoking_allowed';
	/** Lowest active rate plan's nightly base price. Null = no bookable rate plan configured yet. */
	startingPriceCentavos: number | null;
	/** Up to 4 highlighted amenities for the room card — the full list lives on the room type's own settings page. */
	highlightedAmenities: AmenityHighlight[];
	/** Full, uncapped amenity list grouped-ready for the room details dialog. */
	amenities: AmenityDetail[];
}

/**
 * The storefront's undated "Rooms & Rates" listing — every room type a hotel
 * has configured, with an indicative starting price, independent of any
 * specific check-in/check-out search. Distinct from `searchAvailability`,
 * which needs real dates to compute a real bill; this is browsing, not a
 * quote.
 */
export async function listBrowsableRoomTypes(
	hotelId: string,
	opts: { accessibleOnly?: boolean } = {}
): Promise<BrowsableRoomType[]> {
	// None of these four queries depend on another's result (all scoped by hotelId
	// directly) — run them concurrently rather than paying four sequential round-trips.
	const [types, plans, highlightsByType, amenitiesByType] = await Promise.all([
		db
			.select()
			.from(roomTypes)
			.where(
				and(
					eq(roomTypes.hotelId, hotelId),
					opts.accessibleOnly ? eq(roomTypes.wheelchairAccessible, true) : undefined
				)
			)
			.orderBy(asc(roomTypes.sortOrder), asc(roomTypes.name)),
		db
			.select({ roomTypeId: ratePlans.roomTypeId, basePriceCentavos: ratePlans.basePriceCentavos })
			.from(ratePlans)
			.where(and(eq(ratePlans.hotelId, hotelId), eq(ratePlans.isActive, true))),
		loadHighlightedAmenitiesByType(hotelId),
		loadAllAmenitiesByType(hotelId)
	]);
	if (types.length === 0) return [];

	const minPriceByType = new Map<string, number>();
	for (const p of plans) {
		const current = minPriceByType.get(p.roomTypeId);
		if (current == null || p.basePriceCentavos < current) {
			minPriceByType.set(p.roomTypeId, p.basePriceCentavos);
		}
	}

	return types.map((t) => ({
		id: t.id,
		name: t.name,
		category: t.category,
		description: t.description,
		photos: (t.photos as RoomPhoto[]) ?? [],
		baseOccupancy: t.baseOccupancy,
		maxOccupancy: t.maxOccupancy,
		sizeSqm: t.sizeSqm,
		bedConfiguration: (t.bedConfiguration as BedConfigEntry[]) ?? [],
		bedFlexible: t.bedFlexible,
		flexibilityNote: t.flexibilityNote,
		viewType: t.viewType,
		wheelchairAccessible: t.wheelchairAccessible,
		rollInShower: t.rollInShower,
		grabBars: t.grabBars,
		smokingPolicy: t.smokingPolicy,
		startingPriceCentavos: minPriceByType.get(t.id) ?? null,
		highlightedAmenities: highlightsByType.get(t.id) ?? [],
		amenities: amenitiesByType.get(t.id) ?? []
	}));
}

/**
 * Single-room-type lookup for the room detail page's dated mode, layered on top of
 * `searchAvailability` via `.find()` rather than adding a new filter parameter to that
 * function — hotels have a handful of room types, not hundreds, so the extra query cost
 * is negligible, and this keeps the diff off an already-verified, payment-adjacent function.
 */
export async function getAvailableRoomType(
	params: Parameters<typeof searchAvailability>[0] & { roomTypeId: string }
): Promise<AvailableRoomType | null> {
	const { roomTypeId, ...rest } = params;
	const all = await searchAvailability(rest);
	return all.find((t) => t.id === roomTypeId) ?? null;
}

/** Single-room-type lookup for the room detail page's undated mode — same `.find()` pattern as `getAvailableRoomType`. */
export async function getBrowsableRoomType(
	hotelId: string,
	roomTypeId: string,
	opts: { accessibleOnly?: boolean } = {}
): Promise<BrowsableRoomType | null> {
	const all = await listBrowsableRoomTypes(hotelId, opts);
	return all.find((t) => t.id === roomTypeId) ?? null;
}

export interface HotelAmenityHighlight {
	name: string;
	icon: string | null;
	note: string | null;
	/** Raw `amenity_category` enum value (e.g. "outdoor_view") — labelled client-side via `$lib/amenity-categories`. */
	category: string;
}

/** Property-wide amenities for the storefront's "About" section, in admin-configured order. */
export async function listHotelAmenities(hotelId: string): Promise<HotelAmenityHighlight[]> {
	const rows = await db
		.select({
			name: amenities.name,
			icon: amenities.icon,
			note: hotelAmenities.note,
			category: amenities.category
		})
		.from(hotelAmenities)
		.innerJoin(amenities, eq(amenities.id, hotelAmenities.amenityId))
		.where(eq(hotelAmenities.hotelId, hotelId))
		.orderBy(asc(hotelAmenities.sortOrder));
	return rows;
}

/** Statuses that still hold a room going forward, for the "suggest an open date"
 *  calendar — deliberately narrower than `ACTIVE_BOOKING_STATUSES`. That list includes
 *  `checked_out` because same-day inventory/eligibility checks (`searchAvailability`,
 *  `listEligibleRooms`) need a just-vacated room to still count as occupied until
 *  turnover; a multi-week forward-looking calendar has no such same-day concern, and a
 *  `checked_out` stay is history — the guest has already left, so it must not still
 *  render as blocking (it was, confirmed against real hotel data: a `checked_out`
 *  booking showed as "Reserved" on a date nothing was actually holding). */
export const CALENDAR_BLOCKING_BOOKING_STATUSES = [
	'pending_payment',
	'confirmed',
	'checked_in'
] as const;

/** One booking's stay, packed into a capacity lane for the front-desk availability tape chart. */
export interface RoomTypeAvailabilityBar {
	laneIndex: number;
	bookingId: string;
	checkIn: string;
	checkOut: string;
	guestName: string;
	/** Drives the day cell's Occupied-vs-Reserved tag: `checked_in` means a guest is
	 *  actually in-house that day; `pending_payment`/`confirmed` mean the room is held
	 *  but nobody's checked in yet. */
	status: (typeof CALENDAR_BLOCKING_BOOKING_STATUSES)[number];
}

export interface RoomTypeAvailabilityCalendar {
	roomTypeId: string;
	roomTypeName: string;
	totalRooms: number;
	/** Rows to render — `max(totalRooms, bars actually needing a lane)`, so a data
	 *  inconsistency (more overlapping bookings than active rooms) still renders
	 *  every bar rather than silently dropping one. */
	lanes: number;
	bars: RoomTypeAvailabilityBar[];
}

/**
 * Every active booking overlapping `[rangeStart, rangeEnd)` for one room type, packed
 * into capacity lanes via greedy interval scheduling — not physical rooms, since a
 * room isn't assigned to a booking until check-in (`front-desk.ts`'s `roomAssignments`
 * comment). Each booking claims the first lane free since its own `checkIn`, opening a
 * new lane only when none is. Powers front desk's "suggest an open date" tape chart.
 */
export async function getRoomTypeAvailabilityCalendar(
	hotelId: string,
	roomTypeId: string,
	rangeStart: string,
	rangeEnd: string
): Promise<RoomTypeAvailabilityCalendar> {
	const [typeRows, roomCountRows, overlapping] = await Promise.all([
		db
			.select({ name: roomTypes.name })
			.from(roomTypes)
			.where(eq(roomTypes.id, roomTypeId))
			.limit(1),
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
			.select({
				bookingId: bookings.id,
				checkIn: bookings.checkIn,
				checkOut: bookings.checkOut,
				quantity: bookingRooms.quantity,
				guestName: guests.fullName,
				status: bookings.status
			})
			.from(bookingRooms)
			.innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId))
			.innerJoin(orders, eq(orders.id, bookings.orderId))
			.innerJoin(guests, eq(guests.id, orders.guestId))
			.where(
				and(
					eq(bookings.hotelId, hotelId),
					eq(bookingRooms.roomTypeId, roomTypeId),
					inArray(bookings.status, [...CALENDAR_BLOCKING_BOOKING_STATUSES]),
					lt(bookings.checkIn, rangeEnd),
					gt(bookings.checkOut, rangeStart)
				)
			)
			.orderBy(asc(bookings.checkIn))
	]);

	const roomTypeName = typeRows[0]?.name ?? 'Room type';
	const totalRooms = roomCountRows[0]?.n ?? 0;

	// Expand quantity > 1 rows into that many identical sub-intervals — one booking can
	// hold several rooms of the same type, each needing its own lane.
	const intervals = overlapping.flatMap((row) =>
		Array.from({ length: row.quantity }, () => ({
			bookingId: row.bookingId,
			checkIn: row.checkIn,
			checkOut: row.checkOut,
			guestName: row.guestName,
			// Narrowed safely: the query above already filters to CALENDAR_BLOCKING_BOOKING_STATUSES.
			status: row.status as (typeof CALENDAR_BLOCKING_BOOKING_STATUSES)[number]
		}))
	);

	const laneFreeFrom: string[] = [];
	const bars: RoomTypeAvailabilityBar[] = [];
	for (const interval of intervals) {
		let lane = laneFreeFrom.findIndex((freeFrom) => freeFrom <= interval.checkIn);
		if (lane === -1) {
			lane = laneFreeFrom.length;
			laneFreeFrom.push(interval.checkOut);
		} else {
			laneFreeFrom[lane] = interval.checkOut;
		}
		bars.push({ laneIndex: lane, ...interval });
	}

	return {
		roomTypeId,
		roomTypeName,
		totalRooms,
		lanes: Math.max(totalRooms, laneFreeFrom.length),
		bars
	};
}
