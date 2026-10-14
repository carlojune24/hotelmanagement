import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stationIdFor } from '$lib/server/test-station';
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
				{ hotelId, stationId: await stationIdFor(hotelId), diningItemId: venueId, name: 'Adobo', priceCentavos: 25_000 },
				{ hotelId, stationId: await stationIdFor(hotelId), diningItemId: venueId, name: 'Soda', priceCentavos: 8_000 }
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

	describe('guests changing tables', () => {
		const mkTable = async (name: string, extra: { isActive?: boolean } = {}) =>
			(await db.insert(s.diningTables).values({ hotelId, diningItemId: venueId, name, seats: 4, ...extra }).returning())[0]!;
		const mkReservation = async (
			status: 'seated' | 'confirmed',
			tableId: string,
			startsInMin: number,
			lastsMin: number
		) => {
			const [res] = await db
				.insert(s.diningReservations)
				.values({
					hotelId,
					diningItemId: venueId,
					code: `MV-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
					status,
					guestName: 'Move Guest',
					partySize: 2,
					startsAt: new Date(Date.now() + startsInMin * 60_000),
					endsAt: new Date(Date.now() + (startsInMin + lastsMin) * 60_000),
					source: 'staff'
				})
				.returning();
			await db.insert(s.diningReservationTables).values({ reservationId: res!.id, tableId });
			return res!;
		};
		const row = async (id: string) => (await db.select().from(s.diningOrders).where(eq(s.diningOrders.id, id)))[0]!;

		it('carries the whole tab to the new table and frees the old one', async () => {
			const from = await mkTable('M1');
			const to = await mkTable('M2');

			// an earlier, finished sitting at the old table must stay where it was
			const earlier = await place(from.id);
			await serve(earlier.id);
			await c.settleCheck({ hotelId, checkId: (await openCheckOf(from.id))!.id, method: 'card' });
			expect(await openCheckOf(from.id)).toBeNull();

			const paid = await place(from.id);
			await c.settleCheck({ hotelId, checkId: (await openCheckOf(from.id))!.id, method: 'gcash' }); // pays, stays open
			const unpaid = await place(from.id, soda);
			const check = (await openCheckOf(from.id))!;
			await c.requestBill({ hotelId, checkId: check.id });

			const out = await c.moveCheckToTable({ hotelId, checkId: check.id, toTableId: to.id });
			expect(out).toEqual({ fromName: 'M1', toName: 'M2', orderCount: 2 });

			for (const id of [paid.id, unpaid.id]) {
				const r = await row(id);
				expect(r.tableId).toBe(to.id);
				expect(r.tableLabel).toBe('M2');
				expect(r.checkId).toBe(check.id);
			}
			const old = await row(earlier.id);
			expect(old.tableId).toBe(from.id);
			expect(old.tableLabel).toBe('M1');

			expect(await openCheckOf(from.id)).toBeNull();
			const moved = (await openCheckOf(to.id))!;
			expect(moved.id).toBe(check.id);
			expect(moved.billRequestedAt).toBeTruthy(); // the bill request travels with the tab

			const [audit] = await db
				.select()
				.from(s.auditLog)
				.where(and(eq(s.auditLog.hotelId, hotelId), eq(s.auditLog.action, 'dining_check.move_table'), eq(s.auditLog.entityId, check.id)));
			expect(audit!.after).toMatchObject({ tableId: to.id, tableName: 'M2', orderCount: 2 });

			// it settles and frees the table it moved to, and the old one takes a new sitting
			await serve(paid.id);
			await serve(unpaid.id);
			const done = await c.settleCheck({ hotelId, checkId: check.id, method: 'cash', tenderedCentavos: 8_000 });
			expect(done.closed).toBe(true);
			expect(await openCheckOf(to.id)).toBeNull();
			await place(from.id);
			expect((await openCheckOf(from.id))!.id).not.toBe(check.id);
		});

		it('only moves to a table that is empty, in this venue and still in use', async () => {
			const from = await mkTable('R1');
			const a = await place(from.id);
			const check = (await openCheckOf(from.id))!;
			const move = (toTableId: string) =>
				c.moveCheckToTable({ hotelId, checkId: check.id, toTableId });

			const busy = await mkTable('R2');
			await place(busy.id);
			await expect(move(busy.id)).rejects.toThrow(/already has guests/);

			const waiting = await mkTable('R3');
			await place(waiting.id, adobo, { source: 'qr', initialStatus: 'pending_acceptance' });
			await expect(move(waiting.id)).rejects.toThrow(/waiting to be accepted/);

			const booked = await mkTable('R4');
			await mkReservation('confirmed', booked.id, 30, 90);
			await expect(move(booked.id)).rejects.toThrow(/is booked at/);

			const occupiedBySeated = await mkTable('R5');
			await mkReservation('seated', occupiedBySeated.id, -150, 60); // overstaying
			await expect(move(occupiedBySeated.id)).rejects.toThrow(/seated guests/);

			const [otherVenue] = await db.insert(s.diningItems).values({ hotelId, title: 'Bar' }).returning();
			const elsewhere = (await db.insert(s.diningTables).values({ hotelId, diningItemId: otherVenue!.id, name: 'B1', seats: 2 }).returning())[0]!;
			await expect(move(elsewhere.id)).rejects.toThrow(/from this venue/);

			const retired = await mkTable('R6', { isActive: false });
			await expect(move(retired.id)).rejects.toThrow(/from this venue/);

			await expect(move(from.id)).rejects.toThrow(/already at that table/);
			await expect(c.moveCheckToTable({ hotelId: crypto.randomUUID(), checkId: check.id, toTableId: busy.id })).rejects.toThrow(/could not be found/);

			// a booking well after the turn time does not block a walk-in move
			const later = await mkTable('R7');
			await mkReservation('confirmed', later.id, 5 * 60, 90);
			await move(later.id);

			// nothing was half-moved by the refusals
			const r = await row(a.id);
			expect(r.tableId).toBe(later.id);
			expect(r.tableLabel).toBe('R7');

			// a closed tab cannot be moved
			await serve(a.id);
			await c.settleCheck({ hotelId, checkId: check.id, method: 'card' });
			await expect(move((await mkTable('R8')).id)).rejects.toThrow(/already closed/);
		});

		it('ignores a reservation left "seated" from an earlier day, as the Floor does', async () => {
			const from = await mkTable('Y1');
			const stale = await mkTable('Y2');
			await mkReservation('seated', stale.id, -30 * 60, 90); // yesterday, never completed
			const a = await place(from.id);
			const check = (await openCheckOf(from.id))!;

			const out = await c.moveCheckToTable({ hotelId, checkId: check.id, toTableId: stale.id });
			expect(out.toName).toBe('Y2');
			expect((await row(a.id)).tableId).toBe(stale.id);
		});

		it('takes a seated reservation along so the old table stops reading seated', async () => {
			const from = await mkTable('S1');
			const to = await mkTable('S2');
			const res = await mkReservation('seated', from.id, -30, 90);
			const a = await place(from.id);
			const check = (await openCheckOf(from.id))!;
			expect(check.reservationId).toBe(res.id);

			await c.moveCheckToTable({ hotelId, checkId: check.id, toTableId: to.id });
			const tables = await db.select().from(s.diningReservationTables).where(eq(s.diningReservationTables.reservationId, res.id));
			expect(tables.map((t) => t.tableId)).toEqual([to.id]);

			await serve(a.id);
			await c.settleCheck({ hotelId, checkId: check.id, method: 'gcash' });
			const [after] = await db.select().from(s.diningReservations).where(eq(s.diningReservations.id, res.id));
			expect(after!.status).toBe('completed');
		});

		it('moves a QR order that is still waiting, and the waiter accepts it into the new tab', async () => {
			const from = await mkTable('Q1');
			const to = await mkTable('Q2');
			const placed = await place(from.id);
			const qr = await place(from.id, soda, { source: 'qr', initialStatus: 'pending_acceptance' });
			const check = (await openCheckOf(from.id))!;

			const out = await c.moveCheckToTable({ hotelId, checkId: check.id, toTableId: to.id });
			expect(out.orderCount).toBe(2);
			const waiting = await row(qr.id);
			expect(waiting.tableId).toBe(to.id);
			expect(waiting.tableLabel).toBe('Q2');
			expect(waiting.checkId).toBeNull();
			expect((await row(placed.id)).tableId).toBe(to.id);

			await o.acceptQrOrder({ hotelId, orderId: qr.id });
			expect((await row(qr.id)).checkId).toBe(check.id);
			expect(await openCheckOf(from.id)).toBeNull();
		});

		it("shows the guest's order on the new table's QR page, not the old one", async () => {
			const q = await import('./dining-qr');
			const from = await mkTable('G1');
			const to = await mkTable('G2');
			const qr = await place(from.id, adobo, { source: 'qr', initialStatus: 'pending_acceptance' });
			await o.acceptQrOrder({ hotelId, orderId: qr.id });
			const remembered = [{ code: qr.code, token: qr.accessToken }];
			expect((await q.listMyQrOrders(hotelId, from.id, remembered)).orders).toHaveLength(1);

			await c.moveCheckToTable({ hotelId, checkId: (await openCheckOf(from.id))!.id, toTableId: to.id });
			expect((await q.listMyQrOrders(hotelId, from.id, remembered)).orders).toHaveLength(0);
			const there = await q.listMyQrOrders(hotelId, to.id, remembered);
			expect(there.orders.map((x) => x.code)).toEqual([qr.code]);
			expect(there.checkOpen).toBe(true);
		});
	});

	describe('joining one tab into another', () => {
		const mkTable = async (name: string) =>
			(await db.insert(s.diningTables).values({ hotelId, diningItemId: venueId, name, seats: 4 }).returning())[0]!;
		const row = async (id: string) => (await db.select().from(s.diningOrders).where(eq(s.diningOrders.id, id)))[0]!;
		const checkRow = async (id: string) =>
			(await db.select().from(s.diningTableChecks).where(eq(s.diningTableChecks.id, id)))[0]!;
		const join = (fromCheckId: string, intoCheckId: string) =>
			c.mergeCheckIntoCheck({ hotelId, fromCheckId, intoCheckId });

		it("folds one table's orders into the other's bill, frees the first, and settles together", async () => {
			const t1 = await mkTable('J1');
			const t4 = await mkTable('J4');

			const paid = await place(t1.id);
			const from = (await openCheckOf(t1.id))!;
			await c.settleCheck({ hotelId, checkId: from.id, method: 'gcash' }); // paid, still open
			const unpaid = await place(t1.id, soda);
			const friends = await place(t4.id);
			const into = (await openCheckOf(t4.id))!;
			await c.requestBill({ hotelId, checkId: into.id });
			const intoBefore = await checkRow(into.id);

			const out = await join(from.id, into.id);
			expect(out).toEqual({ fromName: 'J1', toName: 'J4', intoTableId: t4.id, orderCount: 2 });

			for (const id of [paid.id, unpaid.id, friends.id]) {
				const r = await row(id);
				expect(r.checkId).toBe(into.id);
				expect(r.tableId).toBe(t4.id);
				expect(r.tableLabel).toBe('J4');
			}
			expect((await row(paid.id)).paymentStatus).toBe('paid'); // not charged again

			const closed = await checkRow(from.id);
			expect(closed.status).toBe('closed');
			expect(closed.forceClearedAt).toBeNull();
			expect(await openCheckOf(t1.id)).toBeNull();

			const survivor = await checkRow(into.id);
			expect(survivor.status).toBe('open');
			expect(survivor.billRequestedAt!.getTime()).toBe(intoBefore.billRequestedAt!.getTime());
			expect(survivor.openedAt.getTime()).toBeLessThanOrEqual(intoBefore.openedAt.getTime());

			const [audit] = await db
				.select()
				.from(s.auditLog)
				.where(and(eq(s.auditLog.hotelId, hotelId), eq(s.auditLog.action, 'dining_check.merge'), eq(s.auditLog.entityId, from.id)));
			expect(audit!.after).toMatchObject({ intoCheckId: into.id, intoTableName: 'J4', orderCount: 2 });

			// one bill for the pair: only what is still unpaid is charged
			const done = await c.settleCheck({ hotelId, checkId: into.id, method: 'cash', tenderedCentavos: 40_000 });
			expect(done.paidCount).toBe(2);
			expect(done.totalCentavos).toBe(33_000);
			await serve(paid.id);
			await serve(unpaid.id);
			await serve(friends.id);
			await c.closeCheck({ hotelId, checkId: into.id });
			expect(await openCheckOf(t4.id)).toBeNull();

			// the freed table takes a new sitting
			await place(t1.id);
			expect((await openCheckOf(t1.id))!.id).not.toBe(from.id);
		});

		it('brings along a QR order still waiting at the first table, and completes its seated reservation', async () => {
			const t1 = await mkTable('K1');
			const t4 = await mkTable('K4');
			const [res] = await db
				.insert(s.diningReservations)
				.values({
					hotelId,
					diningItemId: venueId,
					code: `JN-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
					status: 'seated',
					guestName: 'Join Guest',
					partySize: 2,
					startsAt: new Date(Date.now() - 30 * 60_000),
					endsAt: new Date(Date.now() + 60 * 60_000),
					source: 'staff'
				})
				.returning();
			await db.insert(s.diningReservationTables).values({ reservationId: res!.id, tableId: t1.id });
			await place(t1.id);
			const qr = await place(t1.id, soda, { source: 'qr', initialStatus: 'pending_acceptance' });
			await place(t4.id);
			const from = (await openCheckOf(t1.id))!;
			const into = (await openCheckOf(t4.id))!;
			expect(from.reservationId).toBe(res!.id);

			await join(from.id, into.id);
			const waiting = await row(qr.id);
			expect(waiting.tableId).toBe(t4.id);
			expect(waiting.tableLabel).toBe('K4');
			expect(waiting.checkId).toBeNull();

			const [after] = await db.select().from(s.diningReservations).where(eq(s.diningReservations.id, res!.id));
			expect(after!.status).toBe('completed');

			await o.acceptQrOrder({ hotelId, orderId: qr.id });
			expect((await row(qr.id)).checkId).toBe(into.id);
		});

		it('refuses the same tab, a closed tab, another venue, and another hotel', async () => {
			const t1 = await mkTable('L1');
			const t4 = await mkTable('L4');
			await place(t1.id);
			await place(t4.id);
			const from = (await openCheckOf(t1.id))!;
			const into = (await openCheckOf(t4.id))!;

			await expect(join(from.id, from.id)).rejects.toThrow(/different table/);
			await expect(
				c.mergeCheckIntoCheck({ hotelId: crypto.randomUUID(), fromCheckId: from.id, intoCheckId: into.id })
			).rejects.toThrow(/could not be found/);

			const [bar] = await db.insert(s.diningItems).values({ hotelId, title: 'Rooftop bar' }).returning();
			const [bt] = await db.insert(s.diningTables).values({ hotelId, diningItemId: bar!.id, name: 'B9', seats: 2 }).returning();
			const [beer] = await db
				.insert(s.diningMenuItems)
				.values({ hotelId, stationId: await stationIdFor(hotelId), diningItemId: bar!.id, name: 'Beer', priceCentavos: 9_000 })
				.returning();
			const barOrder = await o.createDiningOrder({
				hotelId,
				venueId: bar!.id,
				orderType: 'dine_in',
				tableId: bt!.id,
				lines: [{ menuItemId: beer!.id, quantity: 1 }]
			});
			const barCheck = (await openCheckOf(bt!.id))!;
			await expect(join(from.id, barCheck.id)).rejects.toThrow(/from this venue/);
			expect((await row(barOrder.id)).checkId).toBe(barCheck.id);

			await c.forceClearCheck({ hotelId, checkId: into.id, reason: 'test' });
			await expect(join(from.id, into.id)).rejects.toThrow(/already closed/);
			await expect(join(into.id, from.id)).rejects.toThrow(/already closed/);

			// nothing was moved by the refusals
			expect((await openCheckOf(t1.id))!.id).toBe(from.id);
		});

		it('still refuses a plain move onto a table that has guests', async () => {
			const t1 = await mkTable('N1');
			const t4 = await mkTable('N4');
			await place(t1.id);
			await place(t4.id);
			await expect(
				c.moveCheckToTable({ hotelId, checkId: (await openCheckOf(t1.id))!.id, toTableId: t4.id })
			).rejects.toThrow(/already has guests/);
		});
	});
});
