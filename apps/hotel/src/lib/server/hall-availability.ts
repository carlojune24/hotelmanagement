import { and, eq, gt, inArray, lt } from 'drizzle-orm';
import { db } from './db/index';
import { functionHalls, hallBookings, type RoomPhoto } from './db/schema/index';

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
const ACTIVE_HALL_BOOKING_STATUSES = ['pending_payment', 'confirmed', 'completed'] as const;

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
