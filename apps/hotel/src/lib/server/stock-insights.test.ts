import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

/**
 * Live-DB test for the stock forecast loader: movements spread over real days (hotel timezone)
 * become the right daily average, days left, run-out date, reorder suggestion and usual supplier.
 * The maths itself is covered exactly in `$lib/stock-forecast.test.ts`. Own throwaway hotel.
 */
const hasDb = Boolean(process.env.DATABASE_URL) || (await hasEnvFile());

async function hasEnvFile(): Promise<boolean> {
	try {
		const { env } = await import('$env/dynamic/private');
		return Boolean(env.DATABASE_URL);
	} catch {
		return false;
	}
}

describe.skipIf(!hasDb)('stock forecast loader (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { seedFinanceDefaults } = await import('./finance/seed-defaults');
	const stock = await import('./stock');
	const { stockForecast } = await import('./stock-insights');

	const TZ = 'Asia/Manila';
	const TODAY = '2031-05-31';
	let hotel = '';
	let soap = '';
	let idle = '';

	/** A movement at noon Manila time, `daysAgo` before TODAY. */
	const at = (daysAgo: number) => new Date(Date.parse(`${TODAY}T04:00:00Z`) - daysAgo * 86_400_000);

	beforeAll(async () => {
		const [h] = await db.insert(s.hotels).values({ slug: `stockfc-${Math.random().toString(36).slice(2, 8)}`, name: 'Forecast', orgRef: mintRef('org') }).returning();
		hotel = h!.id;
		await seedFinanceDefaults(db, hotel);
		const category = (await db.select().from(s.expenseCategories).where(eq(s.expenseCategories.hotelId, hotel)))[0]!.id;
		soap = await stock.createStockItem(hotel, { name: 'Soap', department: 'hotel', kind: 'consumable', unit: 'pcs', reorderLevelMilli: null }, null);
		idle = await stock.createStockItem(hotel, { name: 'Spare bulbs', department: 'hotel', kind: 'consumable', unit: 'pcs', reorderLevelMilli: null }, null);
		await db.update(s.stockItems).set({ leadTimeDays: 3, coverDays: 7 }).where(eq(s.stockItems.id, soap));

		// 100 soaps bought 40 days ago from "Watsons", then 4 a day handed out over the last 20 days.
		const r = await stock.createRestock({
			hotelId: hotel,
			receiptDate: '2031-04-21',
			vendorId: null,
			vendorName: 'Watsons',
			receiptNo: 'W-1',
			totalCentavos: 50_000,
			isVatable: false,
			categoryId: category,
			source: 'hotel',
			attachmentUrl: null,
			note: null,
			lines: [{ itemId: soap, qtyMilli: 100_000 }],
			actor: null
		});
		await db.update(s.stockMovements).set({ createdAt: at(40) }).where(eq(s.stockMovements.restockId, r));
		for (let d = 19; d >= 0; d--) {
			await db.insert(s.stockMovements).values({ hotelId: hotel, itemId: soap, type: 'checkin_kit', qtyMilli: -4_000, createdAt: at(d) });
		}
		await db.insert(s.stockMovements).values({ hotelId: hotel, itemId: idle, type: 'adjust_in', qtyMilli: 10_000, qtyRemainingMilli: 10_000, createdAt: at(30) });
	});

	afterAll(async () => {
		if (!hotel) return;
		await db.delete(s.auditLog).where(eq(s.auditLog.hotelId, hotel));
		await db.delete(s.stockMovements).where(eq(s.stockMovements.hotelId, hotel));
		await db.delete(s.stockRestocks).where(eq(s.stockRestocks.hotelId, hotel));
		await db.delete(s.expenses).where(eq(s.expenses.hotelId, hotel));
		await db.delete(s.hotels).where(eq(s.hotels.id, hotel));
	});

	it('turns the ledger into days left, a run-out date and an order to place', async () => {
		const rows = await stockForecast(hotel, TZ, TODAY);
		const f = rows.find((r) => r.id === soap)!;
		// 80 used over 28 stocked days (it had stock all window) → 80/28 ≈ 2.857 a day; 20 left → 7 days.
		expect(f.onHandMilli).toBe(20_000);
		expect(f.usedMilli).toBe(80_000);
		expect(f.avgDailyMilli).toBeCloseTo(80_000 / 28, 5);
		expect(f.daysLeft).toBeCloseTo(7, 5);
		expect(f.runOutDate).toBe('2031-06-07');
		expect(f.needsOrder).toBe(false); // 7 days left > 3-day lead time
		expect(f.usualSupplier).toBe('Watsons');

		const spare = rows.find((r) => r.id === idle)!;
		expect([spare.avgDailyMilli, spare.daysLeft, spare.needsOrder]).toEqual([0, null, false]); // stocked, never used
	});

	it('puts it on the shopping list once it runs out within the lead time', async () => {
		await db.insert(s.stockMovements).values({ hotelId: hotel, itemId: soap, type: 'waste', qtyMilli: -14_000, createdAt: at(0) });
		const f = (await stockForecast(hotel, TZ, TODAY)).find((r) => r.id === soap)!;
		// 94 used / 28 days ≈ 3.357 a day; 6 left → ~1.8 days ≤ 3 → order (3 + 7) × 3.357 − 6 = 27.57 → 28 pcs.
		expect(f.reason).toBe('runs_out');
		expect(f.suggestedMilli).toBe(28_000);
	});
});
