import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

/**
 * Live-DB tests for table-QR ordering: a code resolves to one table, a rotated code stops
 * working, a QR order waits for staff, and a guest only ever sees or changes their own orders.
 * Own throwaway hotel, removed afterwards; skipped when no DATABASE_URL.
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

describe('remembered orders cookie', async () => {
	const q = await import('./dining-qr');
	it('round-trips, ignores junk and keeps only the latest few', () => {
		const list = Array.from({ length: 15 }, (_, i) => ({ code: `DN-${i}`, token: `t${i}` }));
		const back = q.parseRemembered(q.serializeRemembered(list));
		expect(back).toHaveLength(12);
		expect(back[11]).toEqual({ code: 'DN-14', token: 't14' });
		expect(q.parseRemembered(undefined)).toEqual([]);
		expect(q.parseRemembered('not json')).toEqual([]);
		expect(q.parseRemembered('{"a":1}')).toEqual([]);
		expect(q.parseRemembered('[["only-one"],[1,2],["ok","fine"]]')).toEqual([{ code: 'ok', token: 'fine' }]);
	});
});

describe.skipIf(!hasDb)('table QR ordering (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const q = await import('./dining-qr');
	const o = await import('./dining-orders');

	const tag = `qrtest-${Math.random().toString(36).slice(2, 10)}`;
	const hotelIds: string[] = [];
	let hotelId = '';
	let otherHotelId = '';
	let venueId = '';
	let tableId = '';
	let token = '';
	let adobo = '';

	beforeAll(async () => {
		const mk = async (suffix: string) => {
			const [h] = await db.insert(s.hotels).values({ slug: `${tag}-${suffix}`, name: `QR ${suffix}`, orgRef: mintRef('org') }).returning({ id: s.hotels.id });
			hotelIds.push(h!.id);
			return h!.id;
		};
		hotelId = await mk('a');
		otherHotelId = await mk('b');
		const [v] = await db.insert(s.diningItems).values({ hotelId, title: 'Cafe' }).returning();
		venueId = v!.id;
		const [area] = await db.insert(s.diningAreas).values({ hotelId, diningItemId: venueId, name: 'VIP room' }).returning();
		const [t] = await db.insert(s.diningTables).values({ hotelId, diningItemId: venueId, name: 'V1', seats: 6, areaId: area!.id }).returning();
		tableId = t!.id;
		token = t!.qrToken;
		const [item] = await db.insert(s.diningMenuItems).values({ hotelId, diningItemId: venueId, name: 'Adobo', priceCentavos: 25_000 }).returning();
		adobo = item!.id;
	});

	afterAll(async () => {
		if (hotelIds.length) await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
	});

	it('resolves a code to its table and area, and nothing else', async () => {
		const t = await q.resolveQrTable(hotelId, token);
		expect(t).toMatchObject({ id: tableId, name: 'V1', areaName: 'VIP room', venueId, venueTitle: 'Cafe' });
		expect(await q.resolveQrTable(hotelId, randomUUID())).toBeNull();
		expect(await q.resolveQrTable(hotelId, 'not-a-uuid')).toBeNull();
		// another hotel can't use this hotel's code
		expect(await q.resolveQrTable(otherHotelId, token)).toBeNull();
	});

	it('stops a printed code working once it is rotated or the table is retired', async () => {
		const [t] = await db.insert(s.diningTables).values({ hotelId, diningItemId: venueId, name: 'V2', seats: 2 }).returning();
		const old = t!.qrToken;
		expect(await q.resolveQrTable(hotelId, old)).toBeTruthy();
		await db.update(s.diningTables).set({ qrToken: randomUUID() }).where(eq(s.diningTables.id, t!.id));
		expect(await q.resolveQrTable(hotelId, old)).toBeNull();
		const [fresh] = await db.select().from(s.diningTables).where(eq(s.diningTables.id, t!.id));
		expect(await q.resolveQrTable(hotelId, fresh!.qrToken)).toBeTruthy();
		await db.update(s.diningTables).set({ isActive: false }).where(eq(s.diningTables.id, t!.id));
		expect(await q.resolveQrTable(hotelId, fresh!.qrToken)).toBeNull();
	});

	it('places an order that waits for staff and does not occupy the table', async () => {
		const table = (await q.resolveQrTable(hotelId, token))!;
		const placed = await q.placeQrOrder({ hotelId, table, lines: [{ menuItemId: adobo, quantity: 2 }], guestName: 'Mia' });
		const [row] = await db.select().from(s.diningOrders).where(eq(s.diningOrders.id, placed.id));
		expect(row).toMatchObject({ status: 'pending_acceptance', source: 'qr', orderType: 'dine_in', tableId, guestName: 'Mia', checkId: null });
		expect(row!.totalCentavos).toBe(50_000);
		expect(await db.select().from(s.diningTableChecks).where(eq(s.diningTableChecks.tableId, tableId))).toHaveLength(0);
	});

	it('shows a guest only the orders their own browser placed', async () => {
		const table = (await q.resolveQrTable(hotelId, token))!;
		const mine = await q.placeQrOrder({ hotelId, table, lines: [{ menuItemId: adobo, quantity: 1 }] });
		const theirs = await q.placeQrOrder({ hotelId, table, lines: [{ menuItemId: adobo, quantity: 1 }] });

		const view = await q.listMyQrOrders(hotelId, tableId, [{ code: mine.code, token: mine.accessToken }]);
		expect(view.orders.map((x) => x.code)).toEqual([mine.code]);
		// the right code with the wrong secret shows nothing
		const forged = await q.listMyQrOrders(hotelId, tableId, [{ code: theirs.code, token: randomUUID() }]);
		expect(forged.orders).toEqual([]);
		expect((await q.listMyQrOrders(hotelId, tableId, [])).orders).toEqual([]);
	});

	it('lets a guest withdraw an order only while it is waiting, and only their own', async () => {
		const table = (await q.resolveQrTable(hotelId, token))!;
		const a = await q.placeQrOrder({ hotelId, table, lines: [{ menuItemId: adobo, quantity: 1 }] });
		const b = await q.placeQrOrder({ hotelId, table, lines: [{ menuItemId: adobo, quantity: 1 }] });
		const mineA = [{ code: a.code, token: a.accessToken }];

		await expect(q.cancelMyQrOrder({ hotelId, tableId, remembered: mineA, code: b.code })).rejects.toThrow(/could not find/);
		await q.cancelMyQrOrder({ hotelId, tableId, remembered: mineA, code: a.code });
		const [row] = await db.select().from(s.diningOrders).where(eq(s.diningOrders.id, a.id));
		expect(row!.status).toBe('cancelled');

		// once staff accept it, only staff can change it
		await o.acceptQrOrder({ hotelId, orderId: b.id });
		await expect(q.cancelMyQrOrder({ hotelId, tableId, remembered: [{ code: b.code, token: b.accessToken }], code: b.code })).rejects.toThrow(/already seen/);
	});

	it('asks for the bill only once the table has an accepted order', async () => {
		const [t] = await db.insert(s.diningTables).values({ hotelId, diningItemId: venueId, name: 'V3', seats: 2 }).returning();
		const table = (await q.resolveQrTable(hotelId, t!.qrToken))!;
		const placed = await q.placeQrOrder({ hotelId, table, lines: [{ menuItemId: adobo, quantity: 1 }] });
		const remembered = [{ code: placed.code, token: placed.accessToken }];

		await expect(q.requestMyBill({ hotelId, tableId: t!.id, remembered })).rejects.toThrow(/no open bill/);
		await o.acceptQrOrder({ hotelId, orderId: placed.id });
		await q.requestMyBill({ hotelId, tableId: t!.id, remembered });
		const view = await q.listMyQrOrders(hotelId, t!.id, remembered);
		expect(view).toMatchObject({ checkOpen: true, billRequested: true });
		expect(view.orders[0]!.status).toBe('new');
	});
});
