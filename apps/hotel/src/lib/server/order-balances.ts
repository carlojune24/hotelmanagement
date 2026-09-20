import { and, eq, inArray } from 'drizzle-orm';
import { db } from './db/index';
import { orders } from './db/schema/index';
import { loadOrderLedgers } from './folio';

/**
 * Balance still owed per ROOM (booking / hall line), batched so a list or grid never runs a query
 * per row. Each room keeps its own balance — charges minus what that room has been paid — so this
 * returns one figure per line id (never a booking-wide one). Hotel-scoped: a foreign order id can
 * never resolve.
 */
export async function lineBalances(
	hotelId: string,
	orderIds: string[]
): Promise<Map<string, number>> {
	const out = new Map<string, number>();
	const ids = [...new Set(orderIds)];
	if (ids.length === 0) return out;
	const own = await db
		.select({ id: orders.id })
		.from(orders)
		.where(and(eq(orders.hotelId, hotelId), inArray(orders.id, ids)));
	const ledgers = await loadOrderLedgers(own.map((o) => o.id));
	for (const l of ledgers.values()) {
		for (const line of l.lines) out.set(line.id, line.balanceCentavos);
	}
	return out;
}
