import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';

/**
 * Live-DB tests for a table's check: orders on one table share it, settling pays them all at
 * once, and only a fully served + paid table can be closed (which frees it). Own throwaway
 * hotel, removed afterwards; skipped when no DATABASE_URL.
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

describe.skipIf(!hasDb)('dining table checks (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const o = await import('./dining-orders');
	const c = await import('./dining-checks');
	const { seedFinanceDefaults } = await import('./finance/seed-defaults');
	const { openShift } = await import('./finance/shifts');
	const { businessDateFor } = await import('./finance/shared');

	const tag = `checktest-${Math.random().toString(36).slice(2, 10)}`;
	const hotelIds: string[] = [];
	let hotelId = '';
	let venueId = '';
	let t1 = '';
	let t2 = '';
	let adobo = '';
	let soda = '';
	const today = businessDateFor('Asia/Manila');

	beforeAll(async () => {
		const [h] = await db
			.insert(s.hotels)
			.values({ slug: tag, name: 'Check test', orgRef: mintRef('org') })
			.returning({ id: s.hotels.id });
		hotelId = h!.id;
		hotelIds.push(hotelId);
		await seedFinanceDefaults(db, hotelId);
		const [v] = await db.insert(s.diningItems).values({ hotelId, title: 'Cafe' }).returning();
		venueId = v!.id;
		const [area] = await db.insert(s.diningAreas).values({ hotelId, diningItemId: venueId, name: 'Main' }).returning();
		const tables = await db
			.insert(s.diningTables)
			.values([
				{ hotelId, diningItemId: venueId, name: 'T1', seats: 4, areaId: area!.id },
				{ hotelId, diningItemId: venueId, name: 'T2', seats: 4, areaId: area!.id }
			])
			.returning();
		[t1, t2] = tables.map((t) => t.id) as [string, string];
		const items = await db
			.insert(s.diningMenuItems)
			.values([
				{ hotelId, diningItemId: venueId, name: 'Adobo', priceCentavos: 25_000 },
				{ hotelId, diningItemId: venueId, name: 'Soda', priceCentavos: 8_000 }
			])
			.returning();
		[adobo, soda] = items.map((i) => i.id) as [string, string];
		const settings = await db.select().from(s.financeSettings).where(eq(s.financeSettings.hotelId, hotelId));
		await openShift({
			hotelId,
			cashAccountId: settings[0]!.defaultDrawerAccountId!,
			businessDate: today,
			openingFloatCentavos: 100_000,
			actor: null
		});
	});

	afterAll(async () => {
		if (hotelIds.length) await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
	});

	const place = (tableId: string | null, menuItemId = adobo, extra: Record<string, unknown> = {}) =>
		o.createDiningOrder({
			hotelId,
			venueId,
			orderType: tableId ? 'dine_in' : 'takeaway',
			tableId,
			lines: [{ menuItemId, quantity: 1 }],
			...extra
		});
	const openCheckOf = async (tableId: string) => (await c.getOpenCheckForTable(hotelId, tableId)) ?? null;
	const serve = async (id: string) => {
		await o.setDiningOrderStatus({ hotelId, orderId: id, to: 'preparing' });
		await o.setDiningOrderStatus({ hotelId, orderId: id, to: 'ready' });
		await o.setDiningOrderStatus({ hotelId, orderId: id, to: 'served' });
	};

	it('puts every dine-in order on a table into one open check, and leaves takeaway out', async () => {
		const a = await place(t1);
		const b = await place(t1, soda);
		const takeaway = await place(null);
		const check = await openCheckOf(t1);
		expect(check).toBeTruthy();
		const rows = await db.select().from(s.diningOrders).where(inArray(s.diningOrders.id, [a.id, b.id, takeaway.id]));
		expect(rows.find((r) => r.id === a.id)!.checkId).toBe(check!.id);
		expect(rows.find((r) => r.id === b.id)!.checkId).toBe(check!.id);
		expect(rows.find((r) => r.id === takeaway.id)!.checkId).toBeNull();
		expect(await openCheckOf(t2)).toBeNull();
	});

	it('cannot be closed while orders are unserved or unpaid, then settles and frees the table', async () => {
		const a = await place(t2);
		const b = await place(t2, soda);
		const check = (await openCheckOf(t2))!;

		await expect(c.closeCheck({ hotelId, checkId: check.id })).rejects.toThrow(/not been served/);

		// pay now, but they're still being made: the table stays open
		const first = await c.settleCheck({ hotelId, checkId: check.id, method: 'gcash' });
		expect(first.paidCount).toBe(2);
		expect(first.totalCentavos).toBe(33_000);
		expect(first.closed).toBe(false);
		expect((await openCheckOf(t2))!.id).toBe(check.id);

		await serve(a.id);
		await expect(c.closeCheck({ hotelId, checkId: check.id })).rejects.toThrow(/not been served/);
		await serve(b.id);
		await c.closeCheck({ hotelId, checkId: check.id });
		expect(await openCheckOf(t2)).toBeNull();

		// the table is free for the next sitting, which gets a new check
		await place(t2);
		const next = await openCheckOf(t2);
		expect(next!.id).not.toBe(check.id);
	});

	it('refuses to close with unpaid orders, and cash must cover the whole table', async () => {
		const t = (await db.insert(s.diningTables).values({ hotelId, diningItemId: venueId, name: 'T3', seats: 2 }).returning())[0]!;
		const a = await place(t.id);
		await serve(a.id);
		const check = (await openCheckOf(t.id))!;
		await expect(c.closeCheck({ hotelId, checkId: check.id })).rejects.toThrow(/unpaid/);
		await expect(c.settleCheck({ hotelId, checkId: check.id, method: 'cash', tenderedCentavos: 1_000 })).rejects.toThrow(/cover the whole table/);

		const done = await c.settleCheck({ hotelId, checkId: check.id, method: 'cash', tenderedCentavos: 30_000 });
		expect(done.changeCentavos).toBe(5_000);
		expect(done.closed).toBe(true);
		expect(await openCheckOf(t.id)).toBeNull();
	});

	it('settles a table with the document the cashier picked, one per order', async () => {
		const { createDocumentSeries } = await import('./finance/documents');
		const mk = (type: 'official_receipt' | 'invoice') =>
			createDocumentSeries(hotelId, { type, prefix: type === 'invoice' ? 'INV' : 'OR', serialFrom: 1, serialTo: 99, atpOrPermitNo: 'ATP-1', dateRegistered: null, accreditedPrinter: null, accreditationNo: null, notes: null }, null);
		await mk('official_receipt');
		await mk('invoice');

		const settleWith = async (name: string, documents: 'or' | 'none' | 'invoice') => {
			const t = (await db.insert(s.diningTables).values({ hotelId, diningItemId: venueId, name, seats: 2 }).returning())[0]!;
			await place(t.id);
			await place(t.id, soda);
			const check = (await openCheckOf(t.id))!;
			return c.settleCheck({ hotelId, checkId: check.id, method: 'card', documents });
		};

		const or = await settleWith('D1', 'or');
		expect(or.documents.map((d) => d.type)).toEqual(['official_receipt', 'official_receipt']);
		expect(new Set(or.documents.map((d) => d.formattedNo)).size).toBe(2); // a serial each
		expect(or.documentError).toBeNull();

		const inv = await settleWith('D2', 'invoice');
		expect(inv.documents.map((d) => d.type)).toEqual(['invoice', 'invoice']);

		const none = await settleWith('D3', 'none');
		expect(none.paidCount).toBe(2);
		expect(none.documents).toEqual([]);
		expect(none.documentError).toBeNull();
	});

	it('shows where a table stands, and counts a QR order waiting for staff', async () => {
		const t = (await db.insert(s.diningTables).values({ hotelId, diningItemId: venueId, name: 'T4', seats: 2 }).returning())[0]!;
		const qr = await place(t.id, adobo, { source: 'qr', initialStatus: 'pending_acceptance' });
		// a QR order alone doesn't occupy the table until staff accept it
		expect(await openCheckOf(t.id)).toBeNull();
		expect(await o.countAwaitingAcceptance(hotelId, venueId)).toBeGreaterThanOrEqual(1);

		await o.acceptQrOrder({ hotelId, orderId: qr.id });
		const checks = await c.listOpenChecks(hotelId, venueId);
		const mine = checks.find((x) => x.tableId === t.id)!;
		expect(mine.stage).toBe('ordering');
		expect(mine.orders.map((x) => x.code)).toEqual([qr.code]);

		await serve(qr.id);
		expect((await c.listOpenChecks(hotelId, venueId)).find((x) => x.tableId === t.id)!.stage).toBe('needs_payment');
		await c.settleCheck({ hotelId, checkId: mine.id, method: 'card' });
		expect(await openCheckOf(t.id)).toBeNull();
	});

	it('only accepts an order that is waiting, and a declined one never occupies the table', async () => {
		const t = (await db.insert(s.diningTables).values({ hotelId, diningItemId: venueId, name: 'T5', seats: 2 }).returning())[0]!;
		const qr = await place(t.id, adobo, { source: 'qr', initialStatus: 'pending_acceptance' });
		await o.cancelDiningOrder({ hotelId, orderId: qr.id, reason: 'Kitchen closed' });
		await expect(o.acceptQrOrder({ hotelId, orderId: qr.id })).rejects.toThrow(/not waiting/);
		expect(await openCheckOf(t.id)).toBeNull();
	});

	it('lets a manager clear a stuck table: unpaid orders are cancelled, the table frees up', async () => {
		const t = (await db.insert(s.diningTables).values({ hotelId, diningItemId: venueId, name: 'T6', seats: 2 }).returning())[0]!;
		const a = await place(t.id);
		const check = (await openCheckOf(t.id))!;
		await expect(c.forceClearCheck({ hotelId, checkId: check.id, reason: '  ' })).rejects.toThrow(/reason/);
		await c.forceClearCheck({ hotelId, checkId: check.id, reason: 'Guests left' });
		expect(await openCheckOf(t.id)).toBeNull();
		const [row] = await db.select().from(s.diningOrders).where(eq(s.diningOrders.id, a.id));
		expect(row!.status).toBe('cancelled');
		expect(row!.cancelReason).toMatch(/Guests left/);
		const [closed] = await db.select().from(s.diningTableChecks).where(and(eq(s.diningTableChecks.id, check.id)));
		expect(closed!.forceClearedAt).toBeTruthy();
	});

	it('completes the seated reservation when the table is closed', async () => {
		const t = (await db.insert(s.diningTables).values({ hotelId, diningItemId: venueId, name: 'T7', seats: 4 }).returning())[0]!;
		const [res] = await db
			.insert(s.diningReservations)
			.values({
				hotelId,
				diningItemId: venueId,
				code: `TB-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
				status: 'seated',
				guestName: 'Walk Guest',
				partySize: 2,
				startsAt: new Date(Date.now() - 30 * 60_000),
				endsAt: new Date(Date.now() + 60 * 60_000),
				source: 'staff'
			})
			.returning();
		await db.insert(s.diningReservationTables).values({ reservationId: res!.id, tableId: t.id });
		const a = await place(t.id);
		const check = (await openCheckOf(t.id))!;
		expect(check.reservationId).toBe(res!.id);
		await serve(a.id);
		await c.settleCheck({ hotelId, checkId: check.id, method: 'gcash' });
		const [after] = await db.select().from(s.diningReservations).where(eq(s.diningReservations.id, res!.id));
		expect(after!.status).toBe('completed');
	});

	it('records a bill request once', async () => {
		const t = (await db.insert(s.diningTables).values({ hotelId, diningItemId: venueId, name: 'T8', seats: 2 }).returning())[0]!;
		await place(t.id);
		const check = (await openCheckOf(t.id))!;
		await c.requestBill({ hotelId, checkId: check.id });
		const first = (await openCheckOf(t.id))!.billRequestedAt;
		expect(first).toBeTruthy();
		await c.requestBill({ hotelId, checkId: check.id });
		expect((await openCheckOf(t.id))!.billRequestedAt!.getTime()).toBe(first!.getTime());
	});
});
