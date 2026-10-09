import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

/**
 * Live-DB tests for the kitchen board's server side: what the cook sees, the one-step moves they
 * may make, and the rules around them. Own throwaway hotels and user, removed afterwards; skipped
 * when no DATABASE_URL is configured.
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

describe.skipIf(!hasDb)('kitchen board (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const page = await import('./+page.server');
	const o = await import('$lib/server/dining-orders');

	const tag = `kitchen-${Math.random().toString(36).slice(2, 10)}`;
	const hotelIds: string[] = [];
	let userId = '';
	let hotelA: Awaited<ReturnType<typeof mkHotel>>;
	let hotelB: Awaited<ReturnType<typeof mkHotel>>;
	let venueA = '';
	let steak = '';
	let mojito = '';

	async function mkHotel(suffix: string) {
		const [h] = await db.insert(s.hotels).values({ slug: `${tag}-${suffix}`, name: `Kitchen ${suffix}`, orgRef: mintRef('org') }).returning();
		hotelIds.push(h!.id);
		return h!;
	}
	const roleOf = (capabilities: string[]) => ({ id: 'r', slug: 'r', name: 'Role', isProtected: false, capabilities });
	const asUser = (hotel: { id: string; slug: string; timezone: string; vatRateBps: number }, caps: string[]) =>
		({ hotel, user: { id: userId, email: 'x@x', name: 'Tester', isPlatformAdmin: false }, role: roleOf(caps) }) as never;
	const COOK = ['kitchen:read', 'kitchen:write'];
	const VIEWER = ['kitchen:read'];
	// Floor staff run Dining but no longer cook: starting a dish belongs to the Kitchen role.
	const WAITER = ['dining:read', 'dining:write'];

	const board = (locals: never) => page.load({ locals, url: new URL('http://x/'), depends: () => {} } as never) as Promise<any>;
	const advance = (locals: never, body: Record<string, string>) => {
		const f = new FormData();
		for (const [k, v] of Object.entries(body)) f.set(k, v);
		return page.actions.advance!({ locals, request: { formData: async () => f } } as never) as Promise<any>;
	};
	const place = (lines: { menuItemId: string; quantity: number }[]) =>
		o.createDiningOrder({ hotelId: hotelA.id, venueId: venueA, orderType: 'dine_in', lines });

	beforeAll(async () => {
		const [u] = await db.insert(s.users).values({ email: `${tag}@example.test`, name: 'Kitchen tester', passwordHash: null }).returning({ id: s.users.id });
		userId = u!.id;
		hotelA = await mkHotel('a');
		hotelB = await mkHotel('b');
		const [v] = await db.insert(s.diningItems).values({ hotelId: hotelA.id, title: 'Grill' }).returning();
		venueA = v!.id;
		const [grill, bar] = await db
			.insert(s.diningStations)
			.values([
				{ hotelId: hotelA.id, name: 'Grill' },
				{ hotelId: hotelA.id, name: 'Bar' }
			])
			.returning();
		const items = await db
			.insert(s.diningMenuItems)
			.values([
				{ hotelId: hotelA.id, diningItemId: venueA, name: 'Steak', priceCentavos: 50_000, stationId: grill!.id },
				{ hotelId: hotelA.id, diningItemId: venueA, name: 'Mojito', priceCentavos: 20_000, stationId: bar!.id }
			])
			.returning();
		[steak, mojito] = items.map((i) => i.id) as [string, string];
	});

	afterAll(async () => {
		if (hotelIds.length) await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
		if (userId) await db.delete(s.users).where(eq(s.users.id, userId));
	});

	it('shows live tickets with their stations, only to staff with kitchen access, and only this hotel\'s', async () => {
		const order = await place([
			{ menuItemId: steak, quantity: 2 },
			{ menuItemId: mojito, quantity: 1 }
		]);
		const cook = await board(asUser(hotelA, COOK));
		expect(cook.stations.map((x: any) => x.name)).toEqual(['Bar', 'Grill']);
		const t = cook.orders.find((x: any) => x.id === order.id);
		expect(t.items.map((i: any) => [i.name, i.stationName])).toEqual([['Steak', 'Grill'], ['Mojito', 'Bar']]);
		expect(cook.canMove).toBe(true);
		expect((await board(asUser(hotelA, VIEWER))).canMove).toBe(false);
		await expect(board(asUser(hotelA, []))).rejects.toMatchObject({ status: 403 });
		await expect(board(asUser(hotelA, WAITER))).rejects.toMatchObject({ status: 403 });
		expect((await board(asUser(hotelB, COOK))).orders).toEqual([]);
	});

	it('records which cook started and finished each dish', async () => {
		const order = await place([{ menuItemId: steak, quantity: 1 }]);
		const cook = asUser(hotelA, COOK);
		await advance(cook, { orderId: order.id, to: 'preparing' });
		await advance(cook, { orderId: order.id, to: 'ready' });
		const [line] = await db.select().from(s.diningOrderItems).where(eq(s.diningOrderItems.orderId, order.id));
		expect(line!.startedByUserId).toBe(userId);
		expect(line!.readyByUserId).toBe(userId);
	});

	it('reports finished tickets in History, per station and per cook, for this hotel only', async () => {
		const { kitchenHistory } = await import('$lib/server/kitchen');
		const { businessDateFor } = await import('$lib/server/finance/shared');
		const cook = asUser(hotelA, COOK);
		const order = await place([
			{ menuItemId: steak, quantity: 2 },
			{ menuItemId: mojito, quantity: 1 }
		]);
		await advance(cook, { orderId: order.id, to: 'preparing' });
		await advance(cook, { orderId: order.id, to: 'ready' });

		const today = businessDateFor(hotelA.timezone);
		const h = await kitchenHistory(hotelA, today, today);
		expect(h.tickets).toBeGreaterThanOrEqual(2);
		expect(h.stations.map((x) => x.key)).toEqual(expect.arrayContaining(['Grill', 'Bar']));
		expect(h.topDishes.find((d) => d.name === 'Steak')!.quantity).toBeGreaterThanOrEqual(2);
		expect(h.cooks.find((c) => c.userId === userId)!.tickets).toBeGreaterThanOrEqual(2);
		expect(h.cookNames[userId]).toBe('Kitchen tester');
		expect((await kitchenHistory(hotelB, today, today)).tickets).toBe(0);
		// a period that ended yesterday holds nothing finished today
		const { addDays } = await import('$lib/finance-range');
		expect((await kitchenHistory(hotelA, addDays(today, -9), addDays(today, -2))).tickets).toBe(0);
	});

	it('lets a cook mark a dish sold out and back on, and nobody else', async () => {
		const sold = await import('./sold-out/+page.server');
		const toggle = (locals: never, isAvailable: boolean, itemId = mojito) => {
			const f = new FormData();
			f.set('itemId', itemId);
			f.set('isAvailable', String(isAvailable));
			return sold.actions.setAvailable!({ locals, request: { formData: async () => f } } as never) as Promise<any>;
		};
		const list = async (locals: never) =>
			(await (sold.load as any)({ locals, depends: () => {} })).dishes.find((d: any) => d.id === mojito);

		expect((await toggle(asUser(hotelA, COOK), false)).ok).toMatch(/sold out/);
		expect((await list(asUser(hotelA, COOK))).isAvailable).toBe(false);
		await expect(toggle(asUser(hotelA, VIEWER), true)).rejects.toMatchObject({ status: 403 });
		await expect(toggle(asUser(hotelA, WAITER), true)).rejects.toMatchObject({ status: 403 });
		expect((await toggle(asUser(hotelB, COOK), true)).status).toBe(404);
		expect((await toggle(asUser(hotelA, COOK), true)).ok).toMatch(/back on/);
		expect((await list(asUser(hotelA, COOK))).isAvailable).toBe(true);
	});

	it('tells the floor which orders are ready to serve and which table orders are waiting', async () => {
		const cook = asUser(hotelA, COOK);
		const ready = await place([{ menuItemId: steak, quantity: 1 }]);
		const cooking = await place([{ menuItemId: steak, quantity: 1 }]);
		await advance(cook, { orderId: ready.id, to: 'preparing' });
		await advance(cook, { orderId: ready.id, to: 'ready' });
		await advance(cook, { orderId: cooking.id, to: 'preparing' });

		const a = await o.listServiceAlerts(hotelA.id);
		expect(a.ready.map((x) => x.id)).toContain(ready.id);
		expect(a.ready.map((x) => x.id)).not.toContain(cooking.id);
		expect(a.ready.find((x) => x.id === ready.id)).toMatchObject({ code: ready.code, orderType: 'dine_in' });
		// once served it stops asking for attention, and another hotel never sees it
		await o.setDiningOrderStatus({ hotelId: hotelA.id, orderId: ready.id, to: 'served' });
		expect((await o.listServiceAlerts(hotelA.id)).ready.map((x) => x.id)).not.toContain(ready.id);
		expect((await o.listServiceAlerts(hotelB.id)).ready).toEqual([]);
	});

	it('does not let a waiter start or finish a dish', async () => {
		const order = await place([{ menuItemId: steak, quantity: 1 }]);
		await expect(advance(asUser(hotelA, WAITER), { orderId: order.id, to: 'preparing' })).rejects.toMatchObject({ status: 403 });
	});

	it('lets a cook start and finish a ticket, and drops served tickets from the board', async () => {
		const cook = asUser(hotelA, COOK);
		const order = await place([{ menuItemId: steak, quantity: 1 }]);
		expect((await advance(cook, { orderId: order.id, to: 'preparing' })).moved).toBe(true);
		expect((await board(cook)).orders.find((x: any) => x.id === order.id).status).toBe('preparing');
		expect((await advance(cook, { orderId: order.id, to: 'ready' })).moved).toBe(true);
		const ready = (await board(cook)).orders.find((x: any) => x.id === order.id);
		expect(ready.status).toBe('ready');
		expect(ready.readyAt).toBeTruthy();
		// serving belongs to the Orders board, not the kitchen
		expect((await advance(cook, { orderId: order.id, to: 'served' })).status).toBe(400);
		await o.setDiningOrderStatus({ hotelId: hotelA.id, orderId: order.id, to: 'served' });
		expect((await board(cook)).orders.find((x: any) => x.id === order.id)).toBeUndefined();
	});

	it('refuses a viewer, skipped steps, and another hotel\'s ticket', async () => {
		const order = await place([{ menuItemId: steak, quantity: 1 }]);
		await expect(advance(asUser(hotelA, VIEWER), { orderId: order.id, to: 'preparing' })).rejects.toMatchObject({ status: 403 });
		expect((await advance(asUser(hotelA, COOK), { orderId: order.id, to: 'ready' })).data.error).toMatch(/can't be marked ready/);
		expect((await advance(asUser(hotelB, COOK), { orderId: order.id, to: 'preparing' })).status).toBe(400);
	});

	it('is ready for the table only once every station has finished its part', async () => {
		const cook = asUser(hotelA, COOK);
		const order = await place([
			{ menuItemId: steak, quantity: 1 },
			{ menuItemId: mojito, quantity: 1 }
		]);
		const status = async () => (await board(cook)).orders.find((x: any) => x.id === order.id);

		// the bar can't call it ready before starting
		expect((await advance(cook, { orderId: order.id, to: 'ready', station: 'Bar' })).status).toBe(400);
		expect((await advance(cook, { orderId: order.id, to: 'preparing', station: 'Bar' })).moved).toBe(true);
		expect((await status()).status).toBe('preparing');
		expect((await advance(cook, { orderId: order.id, to: 'ready', station: 'Bar' })).moved).toBe(true);

		// the bar is done but the grill hasn't started: the ticket is still being prepared
		let t = await status();
		expect(t.status).toBe('preparing');
		expect(t.items.find((i: any) => i.name === 'Mojito').readyAt).toBeTruthy();
		expect(t.items.find((i: any) => i.name === 'Steak').startedAt).toBeNull();

		expect((await advance(cook, { orderId: order.id, to: 'preparing', station: 'Grill' })).moved).toBe(true);
		expect((await status()).status).toBe('preparing');
		expect((await advance(cook, { orderId: order.id, to: 'ready', station: 'Grill' })).moved).toBe(true);
		t = await status();
		expect(t.status).toBe('ready');
		expect(t.readyAt).toBeTruthy();
	});

	it('moves a whole ticket at once when no station is named', async () => {
		const cook = asUser(hotelA, COOK);
		const order = await place([
			{ menuItemId: steak, quantity: 1 },
			{ menuItemId: mojito, quantity: 1 }
		]);
		expect((await advance(cook, { orderId: order.id, to: 'preparing' })).moved).toBe(true);
		expect((await advance(cook, { orderId: order.id, to: 'ready' })).moved).toBe(true);
		const t = (await board(cook)).orders.find((x: any) => x.id === order.id);
		expect(t.status).toBe('ready');
		expect(t.items.every((i: any) => i.readyAt && i.startedAt)).toBe(true);
	});

	it('tells the kitchen about a ticket that was just cancelled', async () => {
		const order = await place([{ menuItemId: mojito, quantity: 1 }]);
		await o.cancelDiningOrder({ hotelId: hotelA.id, orderId: order.id, reason: 'Guest left' });
		const cook = await board(asUser(hotelA, COOK));
		expect(cook.orders.find((x: any) => x.id === order.id)).toBeUndefined();
		expect(cook.cancelled.map((c: any) => c.code)).toContain(order.code);
	});
});
