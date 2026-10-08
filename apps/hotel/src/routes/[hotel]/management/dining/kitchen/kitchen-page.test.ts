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

describe.skipIf(!hasDb)('dining kitchen board (live DB)', async () => {
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
	const COOK = ['dining:read', 'dining:write'];
	const VIEWER = ['dining:read'];

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

	it('shows live tickets with their stations, only to staff with dining access, and only this hotel\'s', async () => {
		const order = await place([
			{ menuItemId: steak, quantity: 2 },
			{ menuItemId: mojito, quantity: 1 }
		]);
		const cook = await board(asUser(hotelA, COOK));
		expect(cook.stations).toEqual(['Bar', 'Grill']);
		const t = cook.orders.find((x: any) => x.id === order.id);
		expect(t.items.map((i: any) => [i.name, i.stationName])).toEqual([['Steak', 'Grill'], ['Mojito', 'Bar']]);
		expect(cook.canMove).toBe(true);
		expect((await board(asUser(hotelA, VIEWER))).canMove).toBe(false);
		await expect(board(asUser(hotelA, []))).rejects.toMatchObject({ status: 403 });
		expect((await board(asUser(hotelB, COOK))).orders).toEqual([]);
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

	it('tells the kitchen about a ticket that was just cancelled', async () => {
		const order = await place([{ menuItemId: mojito, quantity: 1 }]);
		await o.cancelDiningOrder({ hotelId: hotelA.id, orderId: order.id, reason: 'Guest left' });
		const cook = await board(asUser(hotelA, COOK));
		expect(cook.orders.find((x: any) => x.id === order.id)).toBeUndefined();
		expect(cook.cancelled.map((c: any) => c.code)).toContain(order.code);
	});
});
