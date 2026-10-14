import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { stationIdFor } from '$lib/server/test-station';

/**
 * Live-DB tests for the Hotel / Dining / Overall scope on the finance reports. The scope is a
 * read-side filter, so these seed finished cash movements directly and check that Overall is what
 * it always was, that Hotel and Dining split it without losing or double counting a centavo, and
 * that another hotel's money never shows. Own throwaway hotels; skipped when no DATABASE_URL.
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

describe.skipIf(!hasDb)('finance report scope (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { seedFinanceDefaults } = await import('./seed-defaults');
	const r = await import('./reports');
	const runner = await import('./report-runner');
	const o = await import('../dining-orders');

	const tag = `scopetest-${Math.random().toString(36).slice(2, 10)}`;
	const hotelIds: string[] = [];
	let hotelA = '';
	let hotelB = '';
	const DAY = '2031-07-15';
	const FROM = '2031-07-01';
	const TO = '2031-07-31';

	async function mkHotel(suffix: string) {
		const [h] = await db
			.insert(s.hotels)
			.values({ slug: `${tag}-${suffix}`, name: `Scope ${suffix}`, orgRef: mintRef('org') })
			.returning({ id: s.hotels.id });
		hotelIds.push(h!.id);
		await seedFinanceDefaults(db, h!.id);
		return h!.id;
	}
	const accountOf = async (hotelId: string) =>
		(await db.select().from(s.financeSettings).where(eq(s.financeSettings.hotelId, hotelId)))[0]!
			.defaultDrawerAccountId!;

	async function move(
		hotelId: string,
		m: {
			direction: 'in' | 'out';
			category: (typeof s.cashMovements.$inferInsert)['category'];
			amount: number;
			sourceType?: string;
			date?: string;
		}
	) {
		await db.insert(s.cashMovements).values({
			hotelId,
			businessDate: m.date ?? DAY,
			direction: m.direction,
			category: m.category,
			cashAccountId: await accountOf(hotelId),
			amountCentavos: m.amount,
			sourceType: m.sourceType ?? 'payment'
		});
	}

	beforeAll(async () => {
		hotelA = await mkHotel('a');
		hotelB = await mkHotel('b');
		await move(hotelA, { direction: 'in', category: 'room_revenue', amount: 500_000 });
		await move(hotelA, { direction: 'in', category: 'hall_revenue', amount: 200_000 });
		await move(hotelA, { direction: 'in', category: 'dining_revenue', amount: 90_000, sourceType: 'dining_order' });
		await move(hotelA, { direction: 'in', category: 'dining_revenue', amount: 10_000, sourceType: 'dining_payment' });
		await move(hotelA, { direction: 'in', category: 'deposit', amount: 150_000 });
		await move(hotelA, { direction: 'out', category: 'refund', amount: 30_000 }); // a room refund
		await move(hotelA, { direction: 'out', category: 'refund', amount: 5_000, sourceType: 'dining_refund' });
		await move(hotelA, { direction: 'out', category: 'expense', amount: 40_000, sourceType: 'expense' });
		await move(hotelA, { direction: 'in', category: 'room_revenue', amount: 111_111, date: '2031-08-20' }); // another month
		await move(hotelB, { direction: 'in', category: 'dining_revenue', amount: 999_999, sourceType: 'dining_order' });

		// a paid restaurant order, for the tender breakdown
		const [v] = await db.insert(s.diningItems).values({ hotelId: hotelA, title: 'Cafe' }).returning();
		const [dish] = await db
			.insert(s.diningMenuItems)
			.values({ hotelId: hotelA, stationId: await stationIdFor(hotelA), diningItemId: v!.id, name: 'Adobo', priceCentavos: 25_000 })
			.returning();
		const placed = await o.createDiningOrder({
			hotelId: hotelA,
			venueId: v!.id,
			orderType: 'takeaway',
			tableId: null,
			lines: [{ menuItemId: dish!.id, quantity: 1 }]
		} as never);
		await db
			.update(s.diningOrders)
			.set({ paymentStatus: 'paid', paymentMethod: 'gcash', businessDate: DAY })
			.where(eq(s.diningOrders.id, placed.id));
	});

	afterAll(async () => {
		if (hotelIds.length) await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
	});

	const sum = (rows: { amountCentavos: number }[]) => rows.reduce((t, x) => t + x.amountCentavos, 0);

	it('Overall (and no scope at all) reads exactly as it always did', async () => {
		const none = await r.revenueBySourceReport(hotelA, FROM, TO);
		const all = await r.revenueBySourceReport(hotelA, FROM, TO, 'all');
		expect(all).toEqual(none);
		const bySource = Object.fromEntries(all.rows.map((x) => [x.source, x.amountCentavos]));
		expect(bySource).toMatchObject({ room_revenue: 500_000, hall_revenue: 200_000, dining_revenue: 100_000, deposit: 150_000 });
		expect(all.totalCentavos).toBe(950_000);
	});

	it('Hotel and Dining split revenue between them with nothing lost or counted twice', async () => {
		const all = await r.revenueBySourceReport(hotelA, FROM, TO, 'all');
		const hotel = await r.revenueBySourceReport(hotelA, FROM, TO, 'hotel');
		const dining = await r.revenueBySourceReport(hotelA, FROM, TO, 'dining');
		expect(dining.rows.map((x) => x.source)).toEqual(['dining_revenue']);
		expect(dining.totalCentavos).toBe(100_000);
		expect(hotel.rows.map((x) => x.source).sort()).toEqual(['deposit', 'hall_revenue', 'room_revenue']);
		expect(hotel.totalCentavos + dining.totalCentavos).toBe(all.totalCentavos);
	});

	it("daily sales: a scope's refunds, takings and net come from its own movements", async () => {
		const all = await r.dailySalesReport(hotelA, DAY);
		expect(all.refundsCentavos).toBe(35_000);

		const dining = await r.dailySalesReport(hotelA, DAY, 'dining');
		expect(dining.revenueBySource).toEqual([{ source: 'dining_revenue', amountCentavos: 100_000 }]);
		expect(dining.refundsCentavos).toBe(5_000);
		expect(dining.depositsCentavos).toBe(0);
		expect(dining.grossRevenueCentavos).toBe(100_000);
		expect(dining.netCashCentavos).toBe(95_000);
		expect(dining.byMethod).toEqual([{ method: 'gcash', count: 1, amountCentavos: 25_000 }]);

		const hotel = await r.dailySalesReport(hotelA, DAY, 'hotel');
		expect(hotel.revenueBySource.map((x) => x.source)).toEqual(['room_revenue', 'hall_revenue', 'incidental_sale', 'other_revenue']);
		expect(hotel.depositsCentavos).toBe(150_000);
		expect(hotel.refundsCentavos).toBe(30_000);
		expect(hotel.grossRevenueCentavos).toBe(850_000);
	});

	it('cashflow narrows to the scope and leaves expenses out of Hotel and Dining', async () => {
		const all = await r.cashflowReport(hotelA, FROM, TO);
		expect(all.totalOutCentavos).toBe(75_000);

		const dining = await r.cashflowReport(hotelA, FROM, TO, 'dining');
		expect(dining.totalInCentavos).toBe(100_000);
		expect(dining.totalOutCentavos).toBe(5_000);

		const hotel = await r.cashflowReport(hotelA, FROM, TO, 'hotel');
		expect(hotel.rows.some((x) => x.category === 'expense')).toBe(false);
		expect(hotel.totalOutCentavos).toBe(30_000);
		expect(hotel.totalInCentavos + dining.totalInCentavos).toBe(all.totalInCentavos);
	});

	it('payment methods for Dining come from restaurant orders, not folio payments', async () => {
		const dining = await r.paymentMethodBreakdown(hotelA, FROM, TO, 'dining');
		expect(dining.rows).toEqual([{ method: 'gcash', count: 1, amountCentavos: 25_000 }]);
		const other = await r.paymentMethodBreakdown(hotelB, FROM, TO, 'dining');
		expect(other.rows).toEqual([]);
	});

	it('never shows another hotel, in any scope', async () => {
		for (const scope of ['all', 'hotel', 'dining'] as const) {
			const rev = await r.revenueBySourceReport(hotelA, FROM, TO, scope);
			expect(sum(rev.rows)).not.toBeGreaterThanOrEqual(999_999);
		}
		expect((await r.revenueBySourceReport(hotelB, FROM, TO, 'dining')).totalCentavos).toBe(999_999);
	});

	it('the runner names the scope, ignores it on reports that are not split, and parses safely', async () => {
		const opts = { timezone: 'Asia/Manila', from: FROM, to: TO };
		const dining = await runner.runReport(hotelA, 'revenue-by-source', { ...opts, scope: 'dining' });
		expect(dining!.name).toBe('Revenue by source — Dining');
		expect(dining!.scope).toBe('dining');
		expect(dining!.summary).toContainEqual(['Scope', 'Dining']);

		const overall = await runner.runReport(hotelA, 'revenue-by-source', opts);
		expect(overall!.name).toBe('Revenue by source');
		expect(overall!.summary.some(([k]) => k === 'Scope')).toBe(false);

		const expenses = await runner.runReport(hotelA, 'expenses', { ...opts, scope: 'dining' });
		expect(expenses!.scope).toBe('all');
		expect(expenses!.name).toBe('Expenses');

		expect(r.parseReportScope('dining')).toBe('dining');
		expect(r.parseReportScope('hotel')).toBe('hotel');
		for (const junk of [null, undefined, '', 'everything', "dining'; drop table x"]) {
			expect(r.parseReportScope(junk)).toBe('all');
		}
	});
});
