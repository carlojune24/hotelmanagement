import { and, count, eq, gte } from 'drizzle-orm';
import { db } from './db/index';
import { ratePlans, roomTypes, rooms } from './db/schema/index';
import { nightsBetween, priceStay, type PriceBreakdown } from './pricing';

export interface AvailableRatePlan {
	id: string;
	name: string;
	description: string | null;
	inclusions: string[];
	minStayNights: number | null;
	maxStayNights: number | null;
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
	ratePlans: AvailableRatePlan[];
}

/**
 * Date range + occupancy → available room types with a full price breakdown per
 * rate plan. Reused by the public booking flow and front desk.
 *
 * `availableRooms` currently counts active rooms of the type only — it does not
 * yet subtract overlapping bookings, since `bookings`/`booking_rooms` land in the
 * next TODO section. Once they exist, subtract rooms already booked for any night
 * in `[checkIn, checkOut)`.
 */
export async function searchAvailability(params: {
	hotelId: string;
	checkIn: string;
	checkOut: string;
	occupancy: number;
}): Promise<AvailableRoomType[]> {
	const { hotelId, checkIn, checkOut, occupancy } = params;
	if (checkIn >= checkOut) throw new Error('checkOut must be after checkIn');
	const stayNights = nightsBetween(checkIn, checkOut).length;

	const types = await db
		.select()
		.from(roomTypes)
		.where(and(eq(roomTypes.hotelId, hotelId), gte(roomTypes.maxOccupancy, occupancy)));
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

	const available = types
		.map((t) => ({ type: t, availableRooms: countByType.get(t.id) ?? 0 }))
		.filter((t) => t.availableRooms > 0);
	if (available.length === 0) return [];

	const plansByType = await db
		.select()
		.from(ratePlans)
		.where(and(eq(ratePlans.hotelId, hotelId), eq(ratePlans.isActive, true)));

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
			ratePlansOut.push({
				id: plan.id,
				name: plan.name,
				description: plan.description,
				inclusions: plan.inclusions,
				minStayNights: plan.minStayNights,
				maxStayNights: plan.maxStayNights,
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
			ratePlans: ratePlansOut
		});
	}

	return results;
}
