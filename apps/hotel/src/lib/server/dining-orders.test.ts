import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';

/**
 * Live-DB tests for dining orders and how they reach the cash ledger. Own throwaway hotels
 * (finance defaults seeded per hotel), removed afterwards; skipped when no DATABASE_URL.
 * Prices are VAT-inclusive at the hotel default of 12%.
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

describe.skipIf(!hasDb)('dining orders and finance (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const o = await import('./dining-orders');
	const { seedFinanceDefaults } = await import('./finance/seed-defaults');
	const { openShift } = await import('./finance/shifts');
	const { daySnapshot } = await import('./finance/dayclose');
	const { revenueBySourceReport } = await import('./finance/reports');
	const { businessDateFor, FinanceError } = await import('./finance/shared');

	const tag = `ordertest-${Math.random().toString(36).slice(2, 10)}`;
	const hotelIds: string[] = [];
	let hotelA = '';
	let hotelB = '';
	let venueA = '';
	let venueB = '';
	let adobo = '';
	let soda = '';
	let soldOut = '';
	let hidden = '';
	let otherHotelDish = '';
	let rice = '';
	let garlicRice = '';
	let kitchenId = '';
	let drawerId = '';
	const today = businessDateFor('Asia/Manila');

	async function mkHotel(suffix: string) {
		const [h] = await db
			.insert(s.hotels)
			.values({ slug: `${tag}-${suffix}`, name: `Order test ${suffix}`, orgRef: mintRef('org') })
			.returning({ id: s.hotels.id });
		hotelIds.push(h!.id);
		return h!.id;
	}

	beforeAll(async () => {
		hotelA = await mkHotel('a');
		hotelB = await mkHotel('b');
		await seedFinanceDefaults(db, hotelA);
		await seedFinanceDefaults(db, hotelB);

		const [va] = await db.insert(s.diningItems).values({ hotelId: hotelA, title: 'Cafe' }).returning();
		const [vb] = await db.insert(s.diningItems).values({ hotelId: hotelB, title: 'Other cafe' }).returning();
		venueA = va!.id;
		venueB = vb!.id;
		const [k] = await db.insert(s.diningStations).values({ hotelId: hotelA, name: 'Kitchen' }).returning();
		kitchenId = k!.id;

		const items = await db
			.insert(s.diningMenuItems)
			.values([
				{ hotelId: hotelA, diningItemId: venueA, name: 'Adobo', priceCentavos: 25_000, stationId: kitchenId },
				{ hotelId: hotelA, diningItemId: venueA, name: 'Soda', priceCentavos: 8_000, taxable: false },
				{ hotelId: hotelA, diningItemId: venueA, name: 'Sold out dish', priceCentavos: 10_000, isAvailable: false },
				{ hotelId: hotelA, diningItemId: venueA, name: 'Hidden dish', priceCentavos: 10_000, isActive: false },
				{ hotelId: hotelB, diningItemId: venueB, name: 'Other hotel dish', priceCentavos: 10_000 }
			])
			.returning();
		[adobo, soda, soldOut, hidden, otherHotelDish] = items.map((i) => i.id) as [string, string, string, string, string];

		const [g] = await db
			.insert(s.diningAddonGroups)
			.values({ hotelId: hotelA, diningItemId: venueA, name: 'Sides', minChoices: 1, maxChoices: 1 })
			.returning();
		const ad = await db
			.insert(s.diningAddons)
			.values([
				{ hotelId: hotelA, groupId: g!.id, name: 'Rice', priceCentavos: 0 },
				{ hotelId: hotelA, groupId: g!.id, name: 'Garlic rice', priceCentavos: 1_500 }
			])
			.returning();
		rice = ad[0]!.id;
		garlicRice = ad[1]!.id;
		await db.insert(s.diningMenuItemAddonGroups).values({ menuItemId: adobo, addonGroupId: g!.id });

		const settings = await db.select().from(s.financeSettings).where(eq(s.financeSettings.hotelId, hotelA));
		drawerId = settings[0]!.defaultDrawerAccountId!;
	});

	afterAll(async () => {
		if (hotelIds.length) await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
	});

	const order = (lines: Parameters<typeof o.createDiningOrder>[0]['lines'], extra: Record<string, unknown> = {}) =>
		o.createDiningOrder({ hotelId: hotelA, venueId: venueA, orderType: 'dine_in', lines, ...extra });

	// ---- creating -------------------------------------------------------------------

	it('prices from the menu, includes add-ons, and extracts VAT without adding it on top', async () => {
		const created = await order([
			{ menuItemId: adobo, quantity: 2, addonIds: [garlicRice], remarks: 'no onions' },
			{ menuItemId: soda, quantity: 1 }
		]);
		// (25000 + 1500) × 2 = 53000, plus a non-taxable soda 8000
		expect(created.totalCentavos).toBe(61_000);
		expect(created.code).toMatch(/^DN-[A-Z2-9]{4}$/);

		const view = (await o.getDiningOrder(hotelA, created.id))!;
		expect(view.totalCentavos).toBe(61_000);
		expect(view.vatCentavos).toBe(Math.round((53_000 * 1200) / 11_200)); // VAT only on the taxable line
		expect(view.items.map((i) => i.name)).toEqual(['Adobo', 'Soda']);
		expect(view.items[0]).toMatchObject({ quantity: 2, remarks: 'no onions', stationName: 'Kitchen', addons: ['Garlic rice'] });
		expect(view.status).toBe('new');
		expect(view.paymentStatus).toBe('unpaid');
	});

	it('keeps the price it was ordered at when the menu changes later', async () => {
		const created = await order([{ menuItemId: adobo, quantity: 1, addonIds: [rice] }]);
		await db.update(s.diningMenuItems).set({ priceCentavos: 99_900 }).where(eq(s.diningMenuItems.id, adobo));
		expect((await o.getDiningOrder(hotelA, created.id))!.totalCentavos).toBe(25_000);
		await db.update(s.diningMenuItems).set({ priceCentavos: 25_000 }).where(eq(s.diningMenuItems.id, adobo));
	});

	it('refuses bad orders with a clear reason', async () => {
		await expect(order([])).rejects.toThrow(/at least one item/);
		await expect(order([{ menuItemId: adobo, quantity: 1 }])).rejects.toThrow(/choose an option for "Sides"/); // required add-on
		await expect(order([{ menuItemId: adobo, quantity: 1, addonIds: [rice, garlicRice] }])).rejects.toThrow(/at most 1/);
		await expect(order([{ menuItemId: soda, quantity: 1, addonIds: [rice] }])).rejects.toThrow(/not offered/); // add-on not on this dish
		await expect(order([{ menuItemId: soldOut, quantity: 1 }])).rejects.toThrow(/sold out/);
		await expect(order([{ menuItemId: hidden, quantity: 1 }])).rejects.toThrow(/no longer on the menu/);
		await expect(order([{ menuItemId: soda, quantity: 0 }])).rejects.toThrow(/Quantity/);
		await expect(order([{ menuItemId: soda, quantity: 1.5 }])).rejects.toThrow(/Quantity/);
		await expect(order([{ menuItemId: soda, quantity: 51 }])).rejects.toThrow(/Quantity/);
	});

	it("will not mix another hotel's dishes or venue into an order", async () => {
		await expect(order([{ menuItemId: otherHotelDish, quantity: 1 }])).rejects.toThrow(/no longer on the menu/);
		await expect(
			o.createDiningOrder({ hotelId: hotelA, venueId: venueB, orderType: 'dine_in', lines: [{ menuItemId: soda, quantity: 1 }] })
		).rejects.toThrow(/could not be found/);
	});

	it('rejects a table from another venue', async () => {
		const [tb] = await db.insert(s.diningTables).values({ hotelId: hotelB, diningItemId: venueB, name: 'X1', seats: 2 }).returning();
		await expect(order([{ menuItemId: soda, quantity: 1 }], { tableId: tb!.id })).rejects.toThrow(/Pick a table/);
		const [ta] = await db.insert(s.diningTables).values({ hotelId: hotelA, diningItemId: venueA, name: 'A1', seats: 2 }).returning();
		const ok = await order([{ menuItemId: soda, quantity: 1 }], { tableId: ta!.id });
		expect((await o.getDiningOrder(hotelA, ok.id))!.tableLabel).toBe('A1');
	});

	// ---- kitchen flow ---------------------------------------------------------------

	it('moves through the kitchen, stamps times, and refuses invalid moves', async () => {
		const c = await order([{ menuItemId: soda, quantity: 1 }]);
		await expect(o.setDiningOrderStatus({ hotelId: hotelA, orderId: c.id, to: 'served' })).rejects.toThrow(/can't be marked/);
		await o.setDiningOrderStatus({ hotelId: hotelA, orderId: c.id, to: 'preparing' });
		await o.setDiningOrderStatus({ hotelId: hotelA, orderId: c.id, to: 'ready' });
		const v = (await o.getDiningOrder(hotelA, c.id))!;
		expect(v.status).toBe('ready');
		expect(v.readyAt).toBeInstanceOf(Date);
		await o.setDiningOrderStatus({ hotelId: hotelA, orderId: c.id, to: 'served' });
		await expect(o.setDiningOrderStatus({ hotelId: hotelA, orderId: c.id, to: 'preparing' })).rejects.toThrow(/can't be marked/);
		await expect(o.setDiningOrderStatus({ hotelId: hotelB, orderId: c.id, to: 'preparing' })).rejects.toThrow(/could not be found/);
	});

	it('shows live orders on the board, and a served order only since the cut-off', async () => {
		const live = await order([{ menuItemId: soda, quantity: 1 }]);
		const done = await order([{ menuItemId: soda, quantity: 1 }]);
		await o.setDiningOrderStatus({ hotelId: hotelA, orderId: done.id, to: 'preparing' });
		await o.setDiningOrderStatus({ hotelId: hotelA, orderId: done.id, to: 'ready' });
		await o.setDiningOrderStatus({ hotelId: hotelA, orderId: done.id, to: 'served' });
		const recent = await o.listBoardOrders(hotelA, { servedSince: new Date(Date.now() - 3_600_000) });
		expect(recent.map((x) => x.id)).toEqual(expect.arrayContaining([live.id, done.id]));
		const later = await o.listBoardOrders(hotelA, { servedSince: new Date(Date.now() + 3_600_000) });
		expect(later.map((x) => x.id)).toContain(live.id);
		expect(later.map((x) => x.id)).not.toContain(done.id);
		expect((await o.listBoardOrders(hotelB, { servedSince: new Date(0) })).length).toBe(0); // tenant scoped
	});

	it('cancels an unpaid order with a reason, and not twice', async () => {
		const c = await order([{ menuItemId: soda, quantity: 1 }]);
		await expect(o.cancelDiningOrder({ hotelId: hotelA, orderId: c.id, reason: '  ' })).rejects.toThrow(/reason/);
		await o.cancelDiningOrder({ hotelId: hotelA, orderId: c.id, reason: 'Guest left' });
		const v = (await o.getDiningOrder(hotelA, c.id))!;
		expect(v.status).toBe('cancelled');
		await expect(o.cancelDiningOrder({ hotelId: hotelA, orderId: c.id, reason: 'again' })).rejects.toThrow(/can't be cancelled/);
		await expect(o.setDiningOrderStatus({ hotelId: hotelA, orderId: c.id, to: 'preparing' })).rejects.toThrow(/can't be marked/);
	});

	// ---- payment and the ledger -----------------------------------------------------

	it('needs an open cashier shift for cash, then posts dining revenue to the drawer and the ledger', async () => {
		const c = await order([{ menuItemId: adobo, quantity: 1, addonIds: [rice] }]); // ₱250.00
		await expect(o.payDiningOrder({ hotelId: hotelA, orderId: c.id, method: 'cash', tenderedCentavos: 30_000 })).rejects.toThrow(
			/Open a cashier shift/
		);
		expect((await o.getDiningOrder(hotelA, c.id))!.paymentStatus).toBe('unpaid'); // nothing half-done

		await openShift({ hotelId: hotelA, cashAccountId: drawerId, businessDate: today, openingFloatCentavos: 100_000, actor: null });
		await expect(o.payDiningOrder({ hotelId: hotelA, orderId: c.id, method: 'cash', tenderedCentavos: 20_000 })).rejects.toBeInstanceOf(FinanceError);

		const [before] = await db.select().from(s.cashAccounts).where(eq(s.cashAccounts.id, drawerId));
		const paid = await o.payDiningOrder({ hotelId: hotelA, orderId: c.id, method: 'cash', tenderedCentavos: 30_000 });
		expect(paid).toEqual({ totalCentavos: 25_000, changeCentavos: 5_000 });

		const v = (await o.getDiningOrder(hotelA, c.id))!;
		expect(v.paymentStatus).toBe('paid');
		expect(v.paymentMethod).toBe('cash');

		const [mv] = await db
			.select()
			.from(s.cashMovements)
			.where(and(eq(s.cashMovements.hotelId, hotelA), eq(s.cashMovements.sourceId, c.id)));
		expect(mv).toMatchObject({ category: 'dining_revenue', direction: 'in', amountCentavos: 25_000, sourceType: 'dining_order' });
		expect(mv!.shiftId).toBeTruthy();
		expect(mv!.voidedAt).toBeNull();

		const [after] = await db.select().from(s.cashAccounts).where(eq(s.cashAccounts.id, drawerId));
		expect(after!.currentBalanceCentavos - before!.currentBalanceCentavos).toBe(25_000);

		// the auto-posted journal entry credits Food & Beverage Revenue (4040)
		const lines = await db
			.select({ code: s.chartOfAccounts.code, debit: s.journalLines.debitCentavos, credit: s.journalLines.creditCentavos })
			.from(s.journalLines)
			.innerJoin(s.chartOfAccounts, eq(s.chartOfAccounts.id, s.journalLines.accountId))
			.where(eq(s.journalLines.journalEntryId, mv!.journalEntryId!));
		expect(lines.find((l) => l.credit > 0)).toMatchObject({ code: '4040', credit: 25_000 });
		expect(lines.find((l) => l.debit > 0)).toMatchObject({ debit: 25_000 });
	});

	it('refuses to pay twice, even at the same moment', async () => {
		const c = await order([{ menuItemId: soda, quantity: 1 }]);
		const results = await Promise.allSettled([
			o.payDiningOrder({ hotelId: hotelA, orderId: c.id, method: 'cash', tenderedCentavos: 8_000 }),
			o.payDiningOrder({ hotelId: hotelA, orderId: c.id, method: 'cash', tenderedCentavos: 8_000 }),
			o.payDiningOrder({ hotelId: hotelA, orderId: c.id, method: 'cash', tenderedCentavos: 8_000 })
		]);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		const movements = await db
			.select()
			.from(s.cashMovements)
			.where(and(eq(s.cashMovements.hotelId, hotelA), eq(s.cashMovements.sourceId, c.id)));
		expect(movements).toHaveLength(1); // exactly one ledger entry
	});

	it('takes a card payment into the bank account with no shift, and needs no tender', async () => {
		const c = await order([{ menuItemId: soda, quantity: 2 }]);
		await o.payDiningOrder({ hotelId: hotelA, orderId: c.id, method: 'card' });
		const [mv] = await db.select().from(s.cashMovements).where(and(eq(s.cashMovements.hotelId, hotelA), eq(s.cashMovements.sourceId, c.id)));
		expect(mv!.shiftId).toBeNull();
		expect(mv!.cashAccountId).not.toBe(drawerId);
		expect(mv!.amountCentavos).toBe(16_000);
	});

	it("won't pay or cancel a paid order the wrong way, or another hotel's order", async () => {
		const c = await order([{ menuItemId: soda, quantity: 1 }]);
		await o.payDiningOrder({ hotelId: hotelA, orderId: c.id, method: 'card' });
		await expect(o.cancelDiningOrder({ hotelId: hotelA, orderId: c.id, reason: 'oops' })).rejects.toThrow(/Void its payment first/);
		await expect(o.payDiningOrder({ hotelId: hotelA, orderId: c.id, method: 'card' })).rejects.toThrow(/already paid/);
		await expect(o.payDiningOrder({ hotelId: hotelB, orderId: c.id, method: 'card' })).rejects.toThrow(/could not be found/);
		const cancelled = await order([{ menuItemId: soda, quantity: 1 }]);
		await o.cancelDiningOrder({ hotelId: hotelA, orderId: cancelled.id, reason: 'no' });
		await expect(o.payDiningOrder({ hotelId: hotelA, orderId: cancelled.id, method: 'card' })).rejects.toThrow(/cancelled/);
	});

	it('voids a payment: reverses the ledger entry and the drawer, and the order can be paid again', async () => {
		const c = await order([{ menuItemId: soda, quantity: 1 }]);
		await o.payDiningOrder({ hotelId: hotelA, orderId: c.id, method: 'cash', tenderedCentavos: 10_000 });
		const [before] = await db.select().from(s.cashAccounts).where(eq(s.cashAccounts.id, drawerId));

		await expect(o.voidDiningOrderPayment({ hotelId: hotelA, orderId: c.id, reason: ' ' })).rejects.toThrow(/reason/);
		await o.voidDiningOrderPayment({ hotelId: hotelA, orderId: c.id, reason: 'Wrong table' });

		const [after] = await db.select().from(s.cashAccounts).where(eq(s.cashAccounts.id, drawerId));
		expect(before!.currentBalanceCentavos - after!.currentBalanceCentavos).toBe(8_000);
		const [mv] = await db.select().from(s.cashMovements).where(and(eq(s.cashMovements.hotelId, hotelA), eq(s.cashMovements.sourceId, c.id)));
		expect(mv!.voidedAt).not.toBeNull();
		const v = (await o.getDiningOrder(hotelA, c.id))!;
		expect(v.paymentStatus).toBe('unpaid');

		await expect(o.voidDiningOrderPayment({ hotelId: hotelA, orderId: c.id, reason: 'again' })).rejects.toThrow(/no payment to void/);
		await o.payDiningOrder({ hotelId: hotelA, orderId: c.id, method: 'cash', tenderedCentavos: 8_000 }); // can be paid again
		expect((await o.getDiningOrder(hotelA, c.id))!.paymentStatus).toBe('paid');
	});

	// ---- finance reporting ----------------------------------------------------------

	it('counts dining in the day-close revenue and the revenue-by-source report', async () => {
		const snap = await daySnapshot(hotelA, today);
		expect(snap.byCategory['in:dining_revenue']).toBeGreaterThan(0);
		expect(snap.grossRevenueCentavos).toBeGreaterThanOrEqual(snap.byCategory['in:dining_revenue']!);
		const rev = await revenueBySourceReport(hotelA, today, today);
		const dining = rev.rows.find((r) => r.source === 'dining_revenue');
		expect(dining?.amountCentavos).toBe(snap.byCategory['in:dining_revenue']);
		expect(rev.totalCentavos).toBeGreaterThanOrEqual(dining!.amountCentavos);
	});

	it('reports paid sales by day, venue, station, dish and method, and drops a voided payment', async () => {
		const report = await o.diningSalesReport(hotelA, today, today);
		expect(report.orders).toBeGreaterThan(0);
		expect(report.byDay.map((d) => d.date)).toEqual([today]);
		expect(report.byDay[0]!.grossCentavos).toBe(report.grossCentavos);
		expect(report.byVenue).toHaveLength(1);
		expect(report.byVenue[0]!.venue).toBe('Cafe');
		expect(report.byMethod.map((m) => m.method).sort()).toEqual(['card', 'cash']);
		const adoboRow = report.byItem.find((i) => i.name === 'Adobo');
		expect(adoboRow?.quantity).toBe(1);
		expect(report.byStation.find((st) => st.station === 'Kitchen')?.grossCentavos).toBe(25_000);
		expect(report.byStation.find((st) => st.station === 'No station')).toBeTruthy(); // sodas have no station
		// station totals add up to the sales total
		expect(report.byStation.reduce((sum, st) => sum + st.grossCentavos, 0)).toBe(report.grossCentavos);

		// A voided payment is not a sale: voiding Adobo's payment drops it from the report
		const adoboOrder = (await o.listRecentOrders(hotelA, { limit: 50 })).find((x) => x.items.some((i) => i.name === 'Adobo') && x.paymentStatus === 'paid')!;
		await o.voidDiningOrderPayment({ hotelId: hotelA, orderId: adoboOrder.id, reason: 'test' });
		const after = await o.diningSalesReport(hotelA, today, today);
		expect(after.grossCentavos).toBe(report.grossCentavos - 25_000);
		expect(after.byItem.find((i) => i.name === 'Adobo')).toBeUndefined();
	});

	it("keeps another hotel's sales out of the report", async () => {
		expect((await o.diningSalesReport(hotelB, today, today)).orders).toBe(0);
	});
});
