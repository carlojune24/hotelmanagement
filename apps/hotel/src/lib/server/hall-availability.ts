import { and, asc, eq, gt, gte, inArray, lt, lte } from 'drizzle-orm';
import { db } from './db/index';
import { functionHalls, guests, hallBookings, orders, type RoomPhoto } from './db/schema/index';

export interface FunctionHallSummary {
	id: string;
	name: string;
	description: string | null;
	photos: RoomPhoto[];
	capacity: number;
	baseHours: number;
	basePriceCentavos: number;
	extraHourFeeCentavos: number;
	includedServices: string[];
	supportedEventTypes: string[];
}

/** Undated browse listing for the storefront's Function Hall section — every active hall a hotel has configured. */
export async function listFunctionHalls(hotelId: string): Promise<FunctionHallSummary[]> {
	const rows = await db
		.select()
		.from(functionHalls)
		.where(and(eq(functionHalls.hotelId, hotelId), eq(functionHalls.isActive, true)))
		.orderBy(functionHalls.sortOrder, functionHalls.name);

	return rows.map((h) => ({
		id: h.id,
		name: h.name,
		description: h.description,
		photos: (h.photos as RoomPhoto[]) ?? [],
		capacity: h.capacity,
		baseHours: h.baseHours,
		basePriceCentavos: h.basePriceCentavos,
		extraHourFeeCentavos: h.extraHourFeeCentavos,
		includedServices: h.includedServices,
		supportedEventTypes: h.supportedEventTypes
	}));
}

/** Booking statuses that hold a hall's time slot (exclude cancelled). */
export const ACTIVE_HALL_BOOKING_STATUSES = ['pending_payment', 'confirmed', 'completed'] as const;

/**
 * Overlap check for one hall on one date: any active `hallBookings` row whose
 * `[startTime, endTime)` intersects the requested window blocks it — the same
 * "pending_payment still holds the slot" policy `searchAvailability` already
 * applies to rooms.
 */
export async function checkHallAvailability(params: {
	hotelId: string;
	functionHallId: string;
	eventDate: string;
	startTime: string;
	endTime: string;
}): Promise<boolean> {
	const { hotelId, functionHallId, eventDate, startTime, endTime } = params;

	const [hall] = await db
		.select({ id: functionHalls.id })
		.from(functionHalls)
		.where(
			and(
				eq(functionHalls.id, functionHallId),
				eq(functionHalls.hotelId, hotelId),
				eq(functionHalls.isActive, true)
			)
		)
		.limit(1);
	if (!hall) return false;

	const overlapping = await db
		.select({ id: hallBookings.id })
		.from(hallBookings)
		.where(
			and(
				eq(hallBookings.functionHallId, functionHallId),
				eq(hallBookings.eventDate, eventDate),
				inArray(hallBookings.status, [...ACTIVE_HALL_BOOKING_STATUSES]),
				lt(hallBookings.startTime, endTime),
				gt(hallBookings.endTime, startTime)
			)
		)
		.limit(1);

	return overlapping.length === 0;
}

export interface HallAvailabilityEvent {
	hallBookingId: string;
	eventDate: string;
	startTime: string;
	endTime: string;
	eventType: string;
	guestName: string;
}

export interface HallAvailabilityCalendar {
	functionHallId: string;
	hallName: string;
	events: HallAvailabilityEvent[];
}

/** Statuses that still hold the hall going forward, for the "suggest an open date"
 *  calendar — deliberately excludes `completed` (unlike `ACTIVE_HALL_BOOKING_STATUSES`,
 *  used for same-day overlap checks): a completed event has already happened and must
 *  not still render as blocking a date nothing is actually holding — same fix as
 *  rooms excluding `checked_out` from their own calendar's status set. */
const CALENDAR_BLOCKING_HALL_STATUSES = ['pending_payment', 'confirmed'] as const;

/**
 * Every active `hallBookings` row for one hall with `eventDate` inside
 * `[rangeStart, rangeEnd]` — a hall is a single bookable unit (one row on the
 * front-desk tape chart), so unlike rooms this needs no lane packing; a day
 * with more than one event just carries more than one entry in the array.
 */
export async function getHallAvailabilityCalendar(
	hotelId: string,
	functionHallId: string,
	rangeStart: string,
	rangeEnd: string
): Promise<HallAvailabilityCalendar> {
	const [hallRows, eventRows] = await Promise.all([
		db
			.select({ name: functionHalls.name })
			.from(functionHalls)
			.where(eq(functionHalls.id, functionHallId))
			.limit(1),
		db
			.select({
				hallBookingId: hallBookings.id,
				eventDate: hallBookings.eventDate,
				startTime: hallBookings.startTime,
				endTime: hallBookings.endTime,
				eventType: hallBookings.eventType,
				guestName: guests.fullName
			})
			.from(hallBookings)
			.innerJoin(orders, eq(orders.id, hallBookings.orderId))
			.innerJoin(guests, eq(guests.id, orders.guestId))
			.where(
				and(
					eq(hallBookings.functionHallId, functionHallId),
					eq(orders.hotelId, hotelId),
					gte(hallBookings.eventDate, rangeStart),
					lte(hallBookings.eventDate, rangeEnd),
					inArray(hallBookings.status, [...CALENDAR_BLOCKING_HALL_STATUSES])
				)
			)
			.orderBy(asc(hallBookings.eventDate), asc(hallBookings.startTime))
	]);

	return {
		functionHallId,
		hallName: hallRows[0]?.name ?? 'Function hall',
		events: eventRows
	};
}
