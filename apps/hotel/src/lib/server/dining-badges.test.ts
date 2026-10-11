import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { stationIdFor } from '$lib/server/test-station';

/**
 * Live-DB tests for the number bubbles on the Dining and Kitchen tabs: what each one counts, that
 * a role without the capability gets zeros, and that another hotel's work never leaks in.
 * Own throwaway hotels, removed afterwards; skipped when no DATABASE_URL.
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

describe.skipIf(!hasDb)('dining tab badges (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const o = await import('./dining-orders');
	const c = await import('./dining-checks');
	const b = await import('./dining-badges');

	const tag = `badgetest-${Math.random().toString(36).slice(2, 10)}`;
	const hotelIds: string[] = [];
	let hotelA = '';
	let hotelB = '';
	let venueA = '';
	let venueB = '';
	let adobo = '';
	let itemB = '';
	let tableA = '';
	let tableB = '';

	async function mkHotel(suffix: string) {
		const [h] = await db
			.insert(s.hotels)
			.values({ slug: `${tag}-${suffix}`, name: `Badges ${suffix}`, orgRef: mintRef('org') })
			.returning({ id: s.hotels.id });
		hotelIds.push(h!.id);
		return h!.id;
	}

	beforeAll(async () => {
		hotelA = await mkHotel('a');
		hotelB = await mkHotel('b');
		const [va] = await db.insert(s.diningItems).values({ hotelId: hotelA, title: 'Cafe' }).returning();
		const [vb] = await db.insert(s.diningItems).values({ hotelId: hotelB, title: 'Other cafe' }).returning();
		venueA = va!.id;
		venueB = vb!.id;
		const [ta] = await db.insert(s.diningTables).values({ hotelId: hotelA, diningItemId: venueA, name: 'T1', seats: 4 }).returning();
		const [tb] = await db.insert(s.diningTables).values({ hotelId: hotelB, diningItemId: venueB, name: 'T1', seats: 4 }).returning();
		tableA = ta!.id;
		tableB = tb!.id;
		const [da] = await db
			.insert(s.diningMenuItems)
			.values({ hotelId: hotelA, stationId: await stationIdFor(hotelA), diningItemId: venueA, name: 'Adobo', priceCentavos: 25_000 })
			.returning();
		const [db2] = await db
			.insert(s.diningMenuItems)
			.values({ hotelId: hotelB, stationId: await stationIdFor(hotelB), diningItemId: venueB, name: 'Soup', priceCentavos: 9_000 })
			.returning();
		adobo = da!.id;
		itemB = db2!.id;
	});

	afterAll(async () => {
		if (hotelIds.length) await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
	});

	const place = (hotelId: string, venueId: string, menuItemId: string, extra: Record<string, unknown>) =>
		o.createDiningOrder({
			hotelId,
			venueId,
			lines: [{ menuItemId, quantity: 1 }],
			...extra
		} as never);
	const badges = (hotelId = hotelA, opts: { dining: boolean; kitchen: boolean } = { dining: true, kitchen: true }) =>
		b.listDiningBadges(hotelId, opts);

	it('starts at zero for a quiet hotel', async () => {
		expect(await badges()).toEqual({ orders: 0, reservations: 0, floor: 0, kitchen: 0 });
	});

	it('counts table-QR orders waiting, and online orders the kitchen has not picked up', async () => {
		await place(hotelA, venueA, adobo, { orderType: 'dine_in', tableId: tableA, source: 'qr', initialStatus: 'pending_acceptance' });
		expect((await badges()).orders).toBe(1);

		// a till order made by staff is not "waiting for you": its cashier is already there
		await place(hotelA, venueA, adobo, { orderType: 'takeaway', tableId: null, source: 'staff' });
		expect((await badges()).orders).toBe(1);

		await place(hotelA, venueA, adobo, { orderType: 'takeaway', tableId: null, source: 'online' });
		expect((await badges()).orders).toBe(2);
	});

	it('counts live tickets that still have a dish nobody started, and drops them once cooking', async () => {
		// the staff and online takeaway tickets above are `new` and untouched; the QR one is not
		// the kitchen's yet, so it is not counted.
		const before = (await badges()).kitchen;
		expect(before).toBe(2);

		const ticket = await place(hotelA, venueA, adobo, { orderType: 'takeaway', tableId: null, source: 'staff' });
		expect((await badges()).kitchen).toBe(3);

		await o.setDiningOrderStatus({ hotelId: hotelA, orderId: ticket.id, to: 'preparing' });
		expect((await badges()).kitchen).toBe(2); // every dish on it is now cooking

		await o.setDiningOrderStatus({ hotelId: hotelA, orderId: ticket.id, to: 'ready' });
		expect((await badges()).kitchen).toBe(2);
	});

	it('counts a table that has asked for the bill', async () => {
		await place(hotelA, venueA, adobo, { orderType: 'dine_in', tableId: tableA, source: 'staff' });
		const check = await c.getOpenCheckForTable(hotelA, tableA);
		expect((await badges()).floor).toBe(0);
		await c.requestBill({ hotelId: hotelA, checkId: check!.id });
		expect((await badges()).floor).toBe(1);
	});

	it('counts pending reservations and ones arriving soon, not far-off or seated ones', async () => {
		const mk = (status: 'pending' | 'confirmed' | 'seated', startsInMin: number) =>
			db.insert(s.diningReservations).values({
				hotelId: hotelA,
				diningItemId: venueA,
				code: `BG-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
				status,
				guestName: 'Badge Guest',
				partySize: 2,
				startsAt: new Date(Date.now() + startsInMin * 60_000),
				endsAt: new Date(Date.now() + (startsInMin + 90) * 60_000),
				source: 'staff'
			});
		await mk('confirmed', 45); // arriving soon
		await mk('confirmed', -20); // a little late, still inside its slot
		await mk('pending', 60 * 24 * 5); // waiting on payment, any day
		await mk('confirmed', 60 * 24 * 3); // too far off
		await mk('seated', -10); // already here
		expect((await badges()).reservations).toBe(3);
	});

	it('gives a role without the capability zeros, and never counts another hotel', async () => {
		const none = await badges(hotelA, { dining: false, kitchen: false });
		expect(none).toEqual({ orders: 0, reservations: 0, floor: 0, kitchen: 0 });

		const diningOnly = await badges(hotelA, { dining: true, kitchen: false });
		expect(diningOnly.kitchen).toBe(0);
		expect(diningOnly.orders).toBeGreaterThan(0);

		await place(hotelB, venueB, itemB, { orderType: 'dine_in', tableId: tableB, source: 'qr', initialStatus: 'pending_acceptance' });
		expect((await badges(hotelB)).orders).toBe(1);
		expect((await badges(hotelA)).orders).toBe(2); // unchanged by the other hotel
	});
});
