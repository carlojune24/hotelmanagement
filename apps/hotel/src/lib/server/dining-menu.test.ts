import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stationIdFor } from '$lib/server/test-station';
import { and, eq, inArray } from 'drizzle-orm';

/** Live-DB tests for the dining menu loaders. Own throwaway hotels, removed afterwards;
 *  skipped when no DATABASE_URL is configured. */
const hasDb = Boolean(process.env.DATABASE_URL) || (await hasEnvFile());

async function hasEnvFile(): Promise<boolean> {
	try {
		const { env } = await import('$env/dynamic/private');
		return Boolean(env.DATABASE_URL);
	} catch {
		return false;
	}
}

describe.skipIf(!hasDb)('dining menu loaders (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const m = await import('./dining-menu');

	const tag = `menutest-${Math.random().toString(36).slice(2, 10)}`;
	const hotelIds: string[] = [];
	let hotelA = '';
	let hotelB = '';
	let venueA = '';
	let venueB = '';
	let mains = '';
	let drinks = '';
	let adobo = '';
	let sidesGroup = '';

	async function mkHotel(suffix: string) {
		const [h] = await db
			.insert(s.hotels)
			.values({ slug: `${tag}-${suffix}`, name: `Menu test ${suffix}`, orgRef: mintRef('org') })
			.returning({ id: s.hotels.id });
		hotelIds.push(h!.id);
		return h!.id;
	}

	beforeAll(async () => {
		hotelA = await mkHotel('a');
		hotelB = await mkHotel('b');
		[{ id: venueA }] = (await db.insert(s.diningItems).values({ hotelId: hotelA, title: 'Cafe A' }).returning({ id: s.diningItems.id })) as [{ id: string }];
		[{ id: venueB }] = (await db.insert(s.diningItems).values({ hotelId: hotelB, title: 'Cafe B' }).returning({ id: s.diningItems.id })) as [{ id: string }];

		const cats = await db
			.insert(s.diningMenuCategories)
			.values([
				{ hotelId: hotelA, diningItemId: venueA, name: 'Mains', sortOrder: 1 },
				{ hotelId: hotelA, diningItemId: venueA, name: 'Drinks', sortOrder: 2 },
				{ hotelId: hotelA, diningItemId: venueA, name: 'Empty section', sortOrder: 3 }
			])
			.returning();
		mains = cats[0]!.id;
		drinks = cats[1]!.id;

		const items = await db
			.insert(s.diningMenuItems)
			.values([
				{ hotelId: hotelA, stationId: await stationIdFor(hotelA), diningItemId: venueA, categoryId: mains, name: 'Adobo', priceCentavos: 25000 },
				{ hotelId: hotelA, stationId: await stationIdFor(hotelA), diningItemId: venueA, categoryId: drinks, name: 'Iced tea', priceCentavos: 8000, isAvailable: false },
				{ hotelId: hotelA, stationId: await stationIdFor(hotelA), diningItemId: venueA, categoryId: mains, name: 'Hidden dish', priceCentavos: 9900, isActive: false },
				{ hotelId: hotelA, stationId: await stationIdFor(hotelA), diningItemId: venueA, categoryId: mains, name: 'Removed dish', priceCentavos: 9900, deletedAt: new Date() },
				{ hotelId: hotelB, stationId: await stationIdFor(hotelB), diningItemId: venueB, name: 'Other hotel dish', priceCentavos: 100 }
			])
			.returning();
		adobo = items[0]!.id;

		const [g] = await db
			.insert(s.diningAddonGroups)
			.values({ hotelId: hotelA, diningItemId: venueA, name: 'Sides', minChoices: 1, maxChoices: 1 })
			.returning();
		sidesGroup = g!.id;
		await db.insert(s.diningAddons).values([
			{ hotelId: hotelA, groupId: sidesGroup, name: 'Rice', priceCentavos: 0 },
			{ hotelId: hotelA, groupId: sidesGroup, name: 'Garlic rice', priceCentavos: 1500 }
		]);
		await db.insert(s.diningMenuItemAddonGroups).values({ menuItemId: adobo, addonGroupId: sidesGroup });
	});

	afterAll(async () => {
		if (hotelIds.length) await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
	});

	it('loads a venue menu with categories, add-ons and attachments, hiding removed dishes', async () => {
		const menu = await m.loadVenueMenu(hotelA, venueA);
		expect(menu.categories.map((c) => c.name)).toEqual(['Mains', 'Drinks', 'Empty section']);
		expect(menu.items.map((i) => i.name).sort()).toEqual(['Adobo', 'Hidden dish', 'Iced tea']); // soft-deleted gone
		const adoboItem = menu.items.find((i) => i.name === 'Adobo')!;
		expect(adoboItem.addonGroupIds).toEqual([sidesGroup]);
		expect(menu.groups).toHaveLength(1);
		expect(menu.groups[0]!.addons.map((a) => a.name).sort()).toEqual(['Garlic rice', 'Rice']);
	});

	it("never returns another hotel's rows for a venue id", async () => {
		const wrongTenant = await m.loadVenueMenu(hotelA, venueB);
		expect(wrongTenant.items).toEqual([]);
		expect(wrongTenant.categories).toEqual([]);
		expect(await m.venueBelongsToHotel(hotelA, venueB)).toBe(false);
		expect(await m.venueBelongsToHotel(hotelA, venueA)).toBe(true);
	});

	it('builds the public menu: active dishes only, sold-out kept and flagged, unused categories dropped', async () => {
		const pub = await m.listPublicMenus(hotelA);
		const venue = pub[venueA]!;
		expect(venue.items.map((i) => i.name).sort()).toEqual(['Adobo', 'Iced tea']);
		expect(venue.items.find((i) => i.name === 'Iced tea')!.isAvailable).toBe(false);
		expect(venue.items.find((i) => i.name === 'Adobo')!.hasAddons).toBe(true);
		expect(venue.categories.map((c) => c.name)).toEqual(['Mains', 'Drinks']); // 'Empty section' dropped
		expect(pub[venueB]).toBeUndefined(); // other hotel's venue never appears
		expect(drinks).toBeTruthy();
	});

	it('lists a hotel\'s stations in order and only its own', async () => {
		// Both hotels already have the "Kitchen" their dishes were put on; it sorts first at 0.
		await db.insert(s.diningStations).values([
			{ hotelId: hotelA, name: 'Hot Section', sortOrder: 1 },
			{ hotelId: hotelA, name: 'Bar', sortOrder: 2 },
			{ hotelId: hotelB, name: 'Other hotel station', sortOrder: 1 }
		]);
		expect((await m.listStations(hotelA)).map((x) => x.name)).toEqual(['Kitchen', 'Hot Section', 'Bar']);
		expect((await m.listStations(hotelB)).map((x) => x.name)).toEqual(['Kitchen', 'Other hotel station']);
	});

	it('rejects a duplicate station name within one hotel but allows it across hotels', async () => {
		await expect(db.insert(s.diningStations).values({ hotelId: hotelA, name: 'Kitchen' })).rejects.toThrow();
		await expect(db.insert(s.diningStations).values({ hotelId: hotelB, name: 'Pastry' })).resolves.toBeDefined();
		await expect(db.insert(s.diningStations).values({ hotelId: hotelA, name: 'Pastry' })).resolves.toBeDefined();
	});

	it('gives a hotel with no stations one default Kitchen, once, and leaves other hotels alone', async () => {
		const fresh = await mkHotel('fresh');
		expect(await m.listStations(fresh)).toEqual([]);
		const first = await m.ensureDefaultStation(fresh);
		expect(first.map((x) => x.name)).toEqual([m.DEFAULT_STATION_NAME]);
		const [again, concurrent] = await Promise.all([m.ensureDefaultStation(fresh), m.ensureDefaultStation(fresh)]);
		expect(again.map((x) => x.id)).toEqual([first[0]!.id]);
		expect(concurrent.map((x) => x.id)).toEqual([first[0]!.id]);

		// a hotel that already set up its own stations is not given another
		const before = (await m.listStations(hotelA)).map((x) => x.name);
		expect((await m.ensureDefaultStation(hotelA)).map((x) => x.name)).toEqual(before);
	});

	describe('deleting a station', () => {
		const o = () => import('./dining-orders');
		const mkStation = async (hotelId: string, name: string) =>
			(await db.insert(s.diningStations).values({ hotelId, name }).returning())[0]!;
		const mkDish = async (name: string, stationId: string) =>
			(
				await db
					.insert(s.diningMenuItems)
					.values({ hotelId: hotelA, diningItemId: venueA, name, priceCentavos: 10_000, stationId })
					.returning()
			)[0]!;
		const lineOf = async (orderId: string) =>
			(await db.select().from(s.diningOrderItems).where(eq(s.diningOrderItems.orderId, orderId)))[0]!;

		it('moves its dishes and the lines of orders still being made, and keeps finished history', async () => {
			const grill = await mkStation(hotelA, 'Grill-del');
			const hot = await mkStation(hotelA, 'Hot-del');
			const steak = await mkDish('Steak', grill.id);
			const orders = await o();
			const live = await orders.createDiningOrder({
				hotelId: hotelA,
				venueId: venueA,
				orderType: 'takeaway',
				tableId: null,
				lines: [{ menuItemId: steak.id, quantity: 1 }]
			});
			const done = await orders.createDiningOrder({
				hotelId: hotelA,
				venueId: venueA,
				orderType: 'takeaway',
				tableId: null,
				lines: [{ menuItemId: steak.id, quantity: 1 }]
			});
			for (const to of ['preparing', 'ready', 'served'] as const) {
				await orders.setDiningOrderStatus({ hotelId: hotelA, orderId: done.id, to });
			}
			expect((await lineOf(live.id)).stationName).toBe('Grill-del');

			const out = await m.deleteStationMovingDishes({ hotelId: hotelA, stationId: grill.id, moveToStationId: hot.id });
			expect(out).toEqual({ name: 'Grill-del', movedDishes: 1, movedTo: 'Hot-del' });

			const [dish] = await db.select().from(s.diningMenuItems).where(eq(s.diningMenuItems.id, steak.id));
			expect(dish!.stationId).toBe(hot.id);
			expect((await m.listStations(hotelA)).some((x) => x.id === grill.id)).toBe(false);

			const open = await lineOf(live.id);
			expect(open.stationName).toBe('Hot-del');
			expect(open.stationId).toBe(hot.id);
			const history = await lineOf(done.id);
			expect(history.stationName).toBe('Grill-del'); // what was made, where, stays as it was
			expect(history.stationId).toBeNull();

			const [audit] = await db
				.select()
				.from(s.auditLog)
				.where(and(eq(s.auditLog.hotelId, hotelA), eq(s.auditLog.action, 'dining_station.delete'), eq(s.auditLog.entityId, grill.id)));
			expect(audit!.after).toMatchObject({ movedDishes: 1, movedTo: 'Hot-del' });
		});

		it('refuses to leave dishes without a station, or to move them somewhere that is not this hotel’s', async () => {
			const cold = await mkStation(hotelA, 'Cold-del');
			await mkDish('Salad', cold.id);
			const elsewhere = await mkStation(hotelB, 'Elsewhere-del');
			const del = (moveToStationId?: string) =>
				m.deleteStationMovingDishes({ hotelId: hotelA, stationId: cold.id, moveToStationId });

			await expect(del()).rejects.toThrow(/choose a station/i);
			await expect(del(cold.id)).rejects.toThrow(/different station/i);
			await expect(del(elsewhere.id)).rejects.toThrow(/from your list/i);
			await expect(del(crypto.randomUUID())).rejects.toThrow(/from your list/i);
			await expect(
				m.deleteStationMovingDishes({ hotelId: hotelB, stationId: cold.id, moveToStationId: elsewhere.id })
			).rejects.toThrow(/not found/i);
			expect((await m.listStations(hotelA)).some((x) => x.id === cold.id)).toBe(true);
		});

		it('deletes a station nothing uses without asking where to move anything', async () => {
			const spare = await mkStation(hotelA, 'Spare-del');
			const out = await m.deleteStationMovingDishes({ hotelId: hotelA, stationId: spare.id });
			expect(out).toEqual({ name: 'Spare-del', movedDishes: 0, movedTo: null });
		});
	});
});
