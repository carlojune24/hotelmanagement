import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';

/**
 * The table-ordering routes end to end, below the UI: the shared layout (table + this guest's orders),
 * the menu page and its `place` action, and the My orders page's `cancel` and `bill` actions, with the
 * guest's cookie. Own throwaway hotels; skipped without a database.
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

describe.skipIf(!hasDb)('table ordering routes (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const o = await import('$lib/server/dining-orders');
	const layout = await import('./+layout.server');
	const menu = await import('./+page.server');
	const myOrders = await import('./orders/+page.server');

	const tag = `tableroutes-${Math.random().toString(36).slice(2, 10)}`;
	const hotelIds: string[] = [];
	let hotelA: any;
	let hotelB: any;
	let token = '';
	let adobo = '';

	async function mkHotel(suffix: string) {
		const [h] = await db.insert(s.hotels).values({ slug: `${tag}-${suffix}`, name: `Table routes ${suffix}`, orgRef: mintRef('org') }).returning();
		hotelIds.push(h!.id);
		return h!;
	}

	/** One guest's browser: it keeps the cookies between requests, like a phone would. */
	function guest(hotel: any, tableToken: string) {
		const jar = new Map<string, string>();
		const cookies = { get: (k: string) => jar.get(k), set: (k: string, v: string) => void jar.set(k, v) };
		const params = { hotel: hotel.slug, token: tableToken };
		const url = new URL(`http://x/${hotel.slug}/dining/t/${tableToken}`);
		const base = { locals: { hotel }, params, cookies, depends: () => {}, url, getClientAddress: () => '203.0.113.9' };
		const form = (fields: Record<string, string>) => {
			const fd = new FormData();
			for (const [k, v] of Object.entries(fields)) fd.set(k, v);
			return { ...base, request: { formData: async () => fd } } as never;
		};
		return {
			layout: () => (layout.load as any)(base) as Promise<any>,
			menu: () => (menu.load as any)(base) as Promise<any>,
			place: (payload: unknown) => (menu.actions.place as any)(form({ payload: JSON.stringify(payload) })) as Promise<any>,
			cancel: (code: string) => (myOrders.actions.cancel as any)(form({ code })) as Promise<any>,
			bill: () => (myOrders.actions.bill as any)(form({})) as Promise<any>
		};
	}
	const caught = async (fn: () => Promise<unknown>) => {
		try {
			await fn();
		} catch (e) {
			return e as { status: number; location?: string };
		}
		return null;
	};

	beforeAll(async () => {
		hotelA = await mkHotel('a');
		hotelB = await mkHotel('b');
		const [v] = await db.insert(s.diningItems).values({ hotelId: hotelA.id, title: 'Resto' }).returning();
		const [area] = await db.insert(s.diningAreas).values({ hotelId: hotelA.id, diningItemId: v!.id, name: 'Indoor' }).returning();
		const [t] = await db.insert(s.diningTables).values({ hotelId: hotelA.id, diningItemId: v!.id, name: 'T2', seats: 4, areaId: area!.id }).returning();
		token = t!.qrToken;
		const [item] = await db.insert(s.diningMenuItems).values({ hotelId: hotelA.id, diningItemId: v!.id, name: 'Adobo', priceCentavos: 8_000 }).returning();
		adobo = item!.id;
	});

	afterAll(async () => {
		if (hotelIds.length) await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
	});

	it('knows the table, and 404s on a wrong code or another hotel', async () => {
		const g = guest(hotelA, token);
		expect(await g.layout()).toMatchObject({ table: { name: 'T2', areaName: 'Indoor', venueTitle: 'Resto' }, orders: [], checkOpen: false, billRequested: false });
		expect(await caught(() => guest(hotelA, crypto.randomUUID()).layout())).toMatchObject({ status: 404 });
		expect(await caught(() => guest(hotelA, 'not-a-code').layout())).toMatchObject({ status: 404 });
		expect(await caught(() => guest(hotelB, token).layout())).toMatchObject({ status: 404 });
		expect(await caught(() => guest(hotelB, token).menu())).toMatchObject({ status: 404 });
	});

	it('serves the menu without the guest\'s orders', async () => {
		const out = await guest(hotelA, token).menu();
		expect(out.menu.items.map((i: any) => i.name)).toEqual(['Adobo']);
		expect(out).not.toHaveProperty('orders');
	});

	it('sends a round, remembers it in the cookie and sends the guest to My orders', async () => {
		const g = guest(hotelA, token);
		const sent = await caught(() => g.place({ lines: [{ menuItemId: adobo, quantity: 2 }], guestName: 'Gina' }));
		expect(sent).toMatchObject({ status: 303 });
		expect(sent!.location).toMatch(new RegExp(`^/${hotelA.slug}/dining/t/${token}/orders\\?sent=DN-`));

		const mine = await g.layout();
		expect(mine.orders).toHaveLength(1);
		expect(mine.orders[0]).toMatchObject({ status: 'pending_acceptance', totalCentavos: 16_000 });
		expect(mine.orders[0].items[0]).toMatchObject({ name: 'Adobo', quantity: 2 });

		// Another phone at the same table sees nothing of it: orders belong to the guest who placed them.
		expect((await guest(hotelA, token).layout()).orders).toEqual([]);
	});

	it('refuses an empty order and a robot (the hidden field)', async () => {
		const g = guest(hotelA, token);
		expect(await g.place({ lines: [], guestName: 'Gina' })).toMatchObject({ status: 400 });
		expect(await g.place({ lines: [{ menuItemId: adobo, quantity: 1 }], guestName: 'Gina', website: 'http://spam' })).toMatchObject({ status: 400 });
		expect((await g.layout()).orders).toEqual([]);
	});

	it('will not take an order without the guest\'s name', async () => {
		const g = guest(hotelA, token);
		const lines = [{ menuItemId: adobo, quantity: 1 }];
		expect(await g.place({ lines })).toMatchObject({ status: 400 });
		expect(await g.place({ lines, guestName: '   ' })).toMatchObject({ status: 400, data: { error: expect.stringMatching(/your name/i) } });
		expect((await g.layout()).orders).toEqual([]);
	});

	it('lets a guest cancel their own order until the restaurant confirms it, and no one else\'s', async () => {
		const g = guest(hotelA, token);
		await caught(() => g.place({ lines: [{ menuItemId: adobo, quantity: 1 }], guestName: 'Gina' }));
		const [order] = (await g.layout()).orders;

		const stranger = guest(hotelA, token);
		expect(await stranger.cancel(order.code)).toMatchObject({ status: 400 });

		expect(await g.cancel(order.code)).toMatchObject({ ok: expect.stringMatching(/cancelled/i) });
		expect((await g.layout()).orders[0].status).toBe('cancelled');
		expect(await g.cancel(order.code)).toMatchObject({ status: 400 }); // already cancelled
	});

	it('asks for the bill only once the restaurant has accepted something', async () => {
		const g = guest(hotelA, token);
		await caught(() => g.place({ lines: [{ menuItemId: adobo, quantity: 1 }], guestName: 'Gina' }));
		expect(await g.bill()).toMatchObject({ status: 400 }); // nothing accepted yet: no bill to ask for

		const { acceptQrOrder } = o;
		const waiting = (await g.layout()).orders.find((x: any) => x.status === 'pending_acceptance');
		const [row] = await db.select({ id: s.diningOrders.id }).from(s.diningOrders).where(inArrayCode(waiting.code));
		await acceptQrOrder({ hotelId: hotelA.id, orderId: row!.id });

		const open = await g.layout();
		expect(open).toMatchObject({ checkOpen: true, billRequested: false });
		expect(await g.bill()).toMatchObject({ ok: expect.stringMatching(/waiter/i) });
		expect(await g.layout()).toMatchObject({ checkOpen: true, billRequested: true });
	});

	function inArrayCode(code: string) {
		return inArray(s.diningOrders.code, [code]);
	}
});
