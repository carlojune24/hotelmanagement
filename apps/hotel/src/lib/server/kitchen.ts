import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { db } from './db/index';
import {
	diningItems,
	diningMenuItems,
	diningOrderItems,
	diningOrders,
	diningStations,
	users
} from './db/schema/index';
import { summarizeKitchen, type HistoryRow, type KitchenSummary } from '$lib/kitchen';
import { listStations } from './dining-menu';

export interface KitchenHistory extends KitchenSummary {
	from: string;
	to: string;
	/** Display names for `cooks[].userId`. */
	cookNames: Record<string, string>;
}

/**
 * How the kitchen did between two business dates (inclusive, on the hotel's own clock). Counts
 * lines that were marked ready in the period, from orders that were not cancelled.
 */
export async function kitchenHistory(
	hotel: { id: string; timezone: string },
	from: string,
	to: string
): Promise<KitchenHistory> {
	const readyDay = sql`(${diningOrderItems.readyAt} at time zone ${hotel.timezone})::date`;
	const rows = await db
		.select({
			orderId: diningOrderItems.orderId,
			orderedAt: diningOrders.createdAt,
			stationName: diningOrderItems.stationName,
			name: diningOrderItems.name,
			quantity: diningOrderItems.quantity,
			startedAt: diningOrderItems.startedAt,
			readyAt: diningOrderItems.readyAt,
			readyByUserId: diningOrderItems.readyByUserId
		})
		.from(diningOrderItems)
		.innerJoin(diningOrders, eq(diningOrders.id, diningOrderItems.orderId))
		.where(
			and(
				eq(diningOrders.hotelId, hotel.id),
				ne(diningOrders.status, 'cancelled'),
				isNotNull(diningOrderItems.readyAt),
				sql`${readyDay} >= ${from}::date`,
				sql`${readyDay} <= ${to}::date`
			)
		);

	// One late rule for every station (the default), the same one the board uses: per-station targets are no longer set.
	const stations = (await listStations(hotel.id)).map((s) => ({ name: s.name, targetMinutes: null }));
	const summary = summarizeKitchen(rows as HistoryRow[], stations, hotel.timezone);

	const ids = summary.cooks.map((c) => c.userId).filter((id): id is string => !!id);
	const named = ids.length
		? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))
		: [];
	return { ...summary, from, to, cookNames: Object.fromEntries(named.map((u) => [u.id, u.name])) };
}

export interface SoldOutDish {
	id: string;
	name: string;
	venue: string;
	stationName: string | null;
	isAvailable: boolean;
}

/** Every dish a guest could order, with its station, for the Kitchen's Sold out page. */
export async function listDishesForKitchen(hotelId: string): Promise<SoldOutDish[]> {
	return db
		.select({
			id: diningMenuItems.id,
			name: diningMenuItems.name,
			venue: diningItems.title,
			stationName: diningStations.name,
			isAvailable: diningMenuItems.isAvailable
		})
		.from(diningMenuItems)
		.innerJoin(diningItems, eq(diningItems.id, diningMenuItems.diningItemId))
		.leftJoin(diningStations, eq(diningStations.id, diningMenuItems.stationId))
		.where(
			and(
				eq(diningMenuItems.hotelId, hotelId),
				eq(diningMenuItems.isActive, true),
				isNull(diningMenuItems.deletedAt)
			)
		)
		.orderBy(asc(diningMenuItems.sortOrder), asc(diningMenuItems.name));
}
