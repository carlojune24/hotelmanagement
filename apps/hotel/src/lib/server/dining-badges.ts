import { and, eq, gt, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';
import { db } from './db/index';
import { diningOrders, diningReservations, diningTableChecks } from './db/schema/index';
import { releasedToKitchen } from './dining-hold';

/**
 * Counts for the little number bubbles on the Dining and Kitchen tabs, so staff see work waiting
 * without opening each tab. Counts only: cheap enough to poll, and nothing here changes any state.
 *
 * - `orders`: table-QR and online takeaway/delivery orders waiting for staff to accept them, plus
 *   reservation pre-orders just released to the kitchen.
 * - `reservations`: bookings still `pending`, and confirmed ones arriving within the next two hours
 *   (or already late, but not past their slot) that nobody has seated.
 * - `floor`: open tables whose guests have asked for the bill.
 * - `kitchen`: live tickets that still have at least one dish nobody has started.
 */
export interface DiningBadges {
	orders: number;
	reservations: number;
	floor: number;
	kitchen: number;
}

export const NO_BADGES: DiningBadges = { orders: 0, reservations: 0, floor: 0, kitchen: 0 };

/** How far ahead a confirmed reservation starts to count as "arriving soon". */
const ARRIVING_WITHIN_MS = 2 * 60 * 60_000;

const count = sql<number>`count(*)::int`;

export async function listDiningBadges(
	hotelId: string,
	opts: { dining: boolean; kitchen: boolean; now?: Date } = { dining: true, kitchen: true }
): Promise<DiningBadges> {
	const now = opts.now ?? new Date();
	const soon = new Date(now.getTime() + ARRIVING_WITHIN_MS);

	const [orders, reservations, floor, kitchen] = await Promise.all([
		opts.dining
			? db
					.select({ n: count })
					.from(diningOrders)
					.where(
						and(
							eq(diningOrders.hotelId, hotelId),
							or(
								eq(diningOrders.status, 'pending_acceptance'),
								// Online takeaway/delivery waits as `pending_acceptance` (counted above). What is left
								// here is a reservation pre-order that has just been released to the kitchen.
								and(
									eq(diningOrders.status, 'new'),
									eq(diningOrders.source, 'online'),
									eq(diningOrders.orderType, 'pre_order'),
									releasedToKitchen
								)
							)
						)
					)
			: [{ n: 0 }],
		opts.dining
			? db
					.select({ n: count })
					.from(diningReservations)
					.where(
						and(
							eq(diningReservations.hotelId, hotelId),
							or(
								eq(diningReservations.status, 'pending'),
								and(
									eq(diningReservations.status, 'confirmed'),
									lte(diningReservations.startsAt, soon),
									gt(diningReservations.endsAt, now)
								)
							)
						)
					)
			: [{ n: 0 }],
		opts.dining
			? db
					.select({ n: count })
					.from(diningTableChecks)
					.where(
						and(
							eq(diningTableChecks.hotelId, hotelId),
							eq(diningTableChecks.status, 'open'),
							isNotNull(diningTableChecks.billRequestedAt)
						)
					)
			: [{ n: 0 }],
		opts.kitchen
			? db
					.select({ n: count })
					.from(diningOrders)
					.where(
						and(
							eq(diningOrders.hotelId, hotelId),
							inArray(diningOrders.status, ['new', 'accepted', 'preparing']),
							releasedToKitchen,
							sql`exists (
								select 1 from dining_order_items i
								where i.order_id = ${diningOrders.id}
								  and i.started_at is null and i.ready_at is null
							)`
						)
					)
			: [{ n: 0 }]
	]);

	return {
		orders: orders[0]?.n ?? 0,
		reservations: reservations[0]?.n ?? 0,
		floor: floor[0]?.n ?? 0,
		kitchen: kitchen[0]?.n ?? 0
	};
}
