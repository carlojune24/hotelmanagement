import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

/**
 * Live-DB tests for the Dining menu's item form: a dish must name a station that belongs to this
 * hotel, and a manager opening the menu of a hotel with no stations gets a default one. Own
 * throwaway hotels and user, removed afterwards; skipped when no DATABASE_URL is configured.
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

describe.skipIf(!hasDb)('dining menu page: dish stations (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const page = await import('./+page.server');

	const tag = `menupage-${Math.random().toString(36).slice(2, 10)}`;
	const hotelIds: string[] = [];
	let userId = '';
	let hotelA: Awaited<ReturnType<typeof mkHotel>>;
	let hotelB: Awaited<ReturnType<typeof mkHotel>>;
	let venueA = '';
	let hot = '';
	let otherHotelStation = '';

	async function mkHotel(suffix: string) {
		const [h] = await db
			.insert(s.hotels)
			.values({ slug: `${tag}-${suffix}`, name: `Menu page ${suffix}`, orgRef: mintRef('org') })
			.returning();
		hotelIds.push(h!.id);
		return h!;
	}

	const roleOf = (capabilities: string[]) => ({ id: 'r', slug: 'r', name: 'Role', isProtected: false, capabilities });
	const asUser = (hotel: { id: string; slug: string; timezone: string; vatRateBps: number }, caps: string[]) =>
		({ hotel, user: { id: userId, email: 'x@x', name: 'Tester', isPlatformAdmin: false }, role: roleOf(caps) }) as never;
	const fd = (o: Record<string, string>) => {
		const f = new FormData();
		for (const [k, v] of Object.entries(o)) f.set(k, v);
		return f;
	};
	const saveItem = (locals: never, body: Record<string, string>) =>
		page.actions.saveItem!({ locals, request: { formData: async () => fd(body) } } as never) as Promise<any>;
	const dish = (extra: Record<string, string> = {}) => ({
		diningItemId: venueA,
		name: 'Chicken Biryani',
		pricePhp: '199',
		sortOrder: '0',
		taxable: 'on',
		isActive: 'on',
		...extra
	});

	const MANAGER = ['dining:read', 'dining:write', 'dining:manage'];
	const VIEWER = ['dining:read'];

	beforeAll(async () => {
		const [u] = await db
			.insert(s.users)
			.values({ email: `${tag}@example.test`, name: 'Menu page tester', passwordHash: null })
			.returning({ id: s.users.id });
		userId = u!.id;
		hotelA = await mkHotel('a');
		hotelB = await mkHotel('b');
		const [v] = await db.insert(s.diningItems).values({ hotelId: hotelA.id, title: 'Cafe' }).returning();
		venueA = v!.id;
		const [h] = await db.insert(s.diningStations).values({ hotelId: hotelA.id, name: 'Hot Section' }).returning();
		hot = h!.id;
		const [other] = await db.insert(s.diningStations).values({ hotelId: hotelB.id, name: 'Elsewhere' }).returning();
		otherHotelStation = other!.id;
	});

	afterAll(async () => {
		if (hotelIds.length) await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
		if (userId) await db.delete(s.users).where(eq(s.users.id, userId));
	});

	const dishesCount = async () =>
		(await db.select().from(s.diningMenuItems).where(eq(s.diningMenuItems.hotelId, hotelA.id))).length;

	it('will not save a dish without a station, with "none", or with another hotel’s station', async () => {
		for (const stationId of [undefined, '', 'none', 'not-a-uuid', otherHotelStation]) {
			const out = await saveItem(asUser(hotelA, MANAGER), dish(stationId === undefined ? {} : { stationId }));
			expect(out.status).toBe(400);
			expect(out.data.error).toMatch(/station/i);
		}
		expect(await dishesCount()).toBe(0);
	});

	it('saves a dish on a station of this hotel, and keeps it there when edited', async () => {
		const created = await saveItem(asUser(hotelA, MANAGER), dish({ stationId: hot }));
		expect(created).toEqual({ ok: 'Added "Chicken Biryani".' });
		const [row] = await db.select().from(s.diningMenuItems).where(eq(s.diningMenuItems.hotelId, hotelA.id));
		expect(row!.stationId).toBe(hot);

		// an edit that drops the station is refused rather than un-assigning the dish
		const edit = await saveItem(asUser(hotelA, MANAGER), dish({ itemId: row!.id, name: 'Biryani' }));
		expect(edit.status).toBe(400);
		const [after] = await db.select().from(s.diningMenuItems).where(eq(s.diningMenuItems.id, row!.id));
		expect(after!.stationId).toBe(hot);
		expect(after!.name).toBe('Chicken Biryani');
	});

	it('is manager work: a viewer is refused', async () => {
		await expect(saveItem(asUser(hotelA, VIEWER), dish({ stationId: hot }))).rejects.toMatchObject({ status: 403 });
	});

	it('gives a manager opening the menu of a hotel with no stations a default one, and a viewer none', async () => {
		const locals = (caps: string[], hotel: typeof hotelB) =>
			({ locals: asUser(hotel, caps), url: new URL('http://localhost/menu') }) as never;
		const viewer = (await page.load(locals(VIEWER, hotelB))) as any;
		// hotel B already has one station, so nothing is added either way
		expect(viewer.stations.map((x: { name: string }) => x.name)).toEqual(['Elsewhere']);

		const [bare] = await db
			.insert(s.hotels)
			.values({ slug: `${tag}-bare`, name: 'Menu page bare', orgRef: mintRef('org') })
			.returning();
		hotelIds.push(bare!.id);
		const asViewer = (await page.load(locals(VIEWER, bare!))) as any;
		expect(asViewer.stations).toEqual([]);
		const asManager = (await page.load(locals(MANAGER, bare!))) as any;
		expect(asManager.stations.map((x: { name: string }) => x.name)).toEqual(['Kitchen']);
	});
});
