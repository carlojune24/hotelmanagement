import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';

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
				{ hotelId: hotelA, diningItemId: venueA, categoryId: mains, name: 'Adobo', priceCentavos: 25000 },
				{ hotelId: hotelA, diningItemId: venueA, categoryId: drinks, name: 'Iced tea', priceCentavos: 8000, isAvailable: false },
				{ hotelId: hotelA, diningItemId: venueA, categoryId: mains, name: 'Hidden dish', priceCentavos: 9900, isActive: false },
				{ hotelId: hotelA, diningItemId: venueA, categoryId: mains, name: 'Removed dish', priceCentavos: 9900, deletedAt: new Date() },
				{ hotelId: hotelB, diningItemId: venueB, name: 'Other hotel dish', priceCentavos: 100 }
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
		await db.insert(s.diningStations).values([
			{ hotelId: hotelA, name: 'Kitchen', sortOrder: 1 },
			{ hotelId: hotelA, name: 'Bar', sortOrder: 2 },
			{ hotelId: hotelB, name: 'Other hotel station' }
		]);
		expect((await m.listStations(hotelA)).map((x) => x.name)).toEqual(['Kitchen', 'Bar']);
		expect((await m.listStations(hotelB)).map((x) => x.name)).toEqual(['Other hotel station']);
	});

	it('rejects a duplicate station name within one hotel but allows it across hotels', async () => {
		await expect(db.insert(s.diningStations).values({ hotelId: hotelA, name: 'Kitchen' })).rejects.toThrow();
		await expect(db.insert(s.diningStations).values({ hotelId: hotelB, name: 'Kitchen' })).resolves.toBeDefined();
	});
});
