import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { listStock, type StockRow } from '$lib/server/stock';
import { WINDOW_DAYS, averageDailyUse, reorder, wholeDays, type DayTotals, type Reorder } from '$lib/stock-forecast';

/**
 * Inventory insights over the stock ledger. Days are the hotel's own calendar days (its IANA
 * timezone). The maths lives in `$lib/stock-forecast.ts`; this only gathers the numbers.
 */

/** Movement types that are stock being used up. A cancelled order (`order_reverse`) nets its order out. */
const USED = sql.raw(`('order', 'order_reverse', 'checkin_kit', 'waste')`);

export interface ForecastRow extends StockRow, Reorder {
	avgDailyMilli: number | null;
	usedMilli: number;
	/** `YYYY-MM-DD` it is expected to run out (hotel calendar), when there is usage to go by. */
	runOutDate: string | null;
	/** Supplier of its most recent (not voided) restock — groups the shopping list. */
	usualSupplier: string | null;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
function addDaysYmd(day: string, n: number): string {
	const d = new Date(`${day}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return ymd(d);
}

/** Every active item with its usage average, days left, run-out date and reorder suggestion. */
export async function stockForecast(hotelId: string, timezone: string, today: string): Promise<ForecastRow[]> {
	const items = (await listStock(hotelId)).filter((i) => i.isActive);
	if (!items.length) return [];
	const start = addDaysYmd(today, -(WINDOW_DAYS - 1));
	const local = sql`(m.created_at at time zone ${timezone})::date`;

	const [opening, perDay, suppliers] = await Promise.all([
		db.execute<{ item_id: string; q: string }>(sql`
			select m.item_id, sum(m.qty_milli) q from stock_movements m
			where m.hotel_id = ${hotelId} and ${local} < ${start}::date group by m.item_id`),
		db.execute<{ item_id: string; d: string; net: string; used: string }>(sql`
			select m.item_id, ${local}::text d, sum(m.qty_milli) net,
				sum(case when m.type in ${USED} then -m.qty_milli else 0 end) used
			from stock_movements m
			where m.hotel_id = ${hotelId} and ${local} between ${start}::date and ${today}::date
			group by m.item_id, d`),
		db.execute<{ item_id: string; supplier: string | null }>(sql`
			select distinct on (m.item_id) m.item_id, coalesce(v.name, r.vendor_name) supplier
			from stock_movements m
			join stock_restocks r on r.id = m.restock_id and r.voided_at is null
			left join vendors v on v.id = r.vendor_id
			where m.hotel_id = ${hotelId} and m.type = 'restock'
			order by m.item_id, r.receipt_date desc, r.created_at desc`)
	]);

	const openingBy = new Map(opening.map((r) => [r.item_id, Number(r.q)]));
	const daysBy = new Map<string, Map<string, DayTotals>>();
	for (const r of perDay) {
		const m = daysBy.get(r.item_id) ?? new Map<string, DayTotals>();
		m.set(r.d, { net: Number(r.net), used: Number(r.used) });
		daysBy.set(r.item_id, m);
	}
	const supplierBy = new Map(suppliers.map((r) => [r.item_id, r.supplier]));
	const window = Array.from({ length: WINDOW_DAYS }, (_, i) => addDaysYmd(start, i));

	return items.map((item) => {
		const byDay = daysBy.get(item.id);
		const days = window.map((d) => byDay?.get(d) ?? { net: 0, used: 0 });
		const use = averageDailyUse(openingBy.get(item.id) ?? 0, days);
		const r = reorder({
			onHandMilli: item.onHandMilli,
			avgMilli: use.avgMilli,
			unit: item.unit,
			leadDays: item.leadTimeDays,
			coverDays: item.coverDays,
			reorderLevelMilli: item.reorderLevelMilli
		});
		return {
			...item,
			...r,
			avgDailyMilli: use.avgMilli,
			usedMilli: use.usedMilli,
			runOutDate: r.daysLeft != null ? addDaysYmd(today, wholeDays(r.daysLeft)) : null,
			usualSupplier: supplierBy.get(item.id) ?? null
		};
	});
}
