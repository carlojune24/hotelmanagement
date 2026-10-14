import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

/**
 * Live-DB tests for the Kitchen → Stations delete flow: a station with dishes cannot just
 * disappear, its dishes go to a station chosen in the dialog, and only `kitchen:manage` may do it.
 * Own throwaway hotels and user, removed afterwards; skipped when no DATABASE_URL is configured.
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

describe.skipIf(!hasDb)('kitchen stations page: delete (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const page = await import('./+page.server');

	const tag = `stationpage-${Math.random().toString(36).slice(2, 10)}`;
	const hotelIds: string[] = [];
	let userId = '';
	let hotelA: Awaited<ReturnType<typeof mkHotel>>;
	let hotelB: Awaited<ReturnType<typeof mkHotel>>;
	let venueA = '';

	async function mkHotel(suffix: string) {
		const [h] = await db
			.insert(s.hotels)
			.values({ slug: `${tag}-${suffix}`, name: `Stations ${suffix}`, orgRef: mintRef('org') })
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
	const deleteStation = (locals: never, body: Record<string, string>) =>
		page.actions.deleteStation!({ locals, request: { formData: async () => fd(body) } } as never) as Promise<any>;
	const station = async (hotelId: string, name: string) =>
		(await db.insert(s.diningStations).values({ hotelId, name }).returning())[0]!;

	const MANAGER = ['kitchen:read', 'kitchen:manage'];
	const COOK = ['kitchen:read'];

	beforeAll(async () => {
		const [u] = await db
			.insert(s.users)
			.values({ email: `${tag}@example.test`, name: 'Stations tester', passwordHash: null })
			.returning({ id: s.users.id });
		userId = u!.id;
		hotelA = await mkHotel('a');
		hotelB = await mkHotel('b');
		const [v] = await db.insert(s.diningItems).values({ hotelId: hotelA.id, title: 'Cafe' }).returning();
		venueA = v!.id;
	});

	afterAll(async () => {
		if (hotelIds.length) await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
		if (userId) await db.delete(s.users).where(eq(s.users.id, userId));
	});

	it('moves the dishes to the chosen station, and says where', async () => {
		const kitchen = await station(hotelA.id, 'Kitchen');
		const hot = await station(hotelA.id, 'Hot Section');
		await db.insert(s.diningMenuItems).values([
			{ hotelId: hotelA.id, diningItemId: venueA, name: 'Adobo', priceCentavos: 8_000, stationId: kitchen.id },
			{ hotelId: hotelA.id, diningItemId: venueA, name: 'Layua', priceCentavos: 15_000, stationId: kitchen.id }
		]);

		const out = await deleteStation(asUser(hotelA, MANAGER), { stationId: kitchen.id, moveTo: hot.id });
		expect(out).toEqual({ ok: 'Deleted "Kitchen". 2 dishes moved to "Hot Section".' });
		const dishes = await db.select().from(s.diningMenuItems).where(eq(s.diningMenuItems.hotelId, hotelA.id));
		expect(dishes.map((d) => d.stationId)).toEqual([hot.id, hot.id]);
		expect(await db.select().from(s.diningStations).where(eq(s.diningStations.id, kitchen.id))).toEqual([]);
	});

	it('refuses to delete a station with dishes unless they are given somewhere to go', async () => {
		const grill = await station(hotelA.id, 'Grill');
		await db
			.insert(s.diningMenuItems)
			.values({ hotelId: hotelA.id, diningItemId: venueA, name: 'Steak', priceCentavos: 50_000, stationId: grill.id });

		const none = await deleteStation(asUser(hotelA, MANAGER), { stationId: grill.id });
		expect(none.status).toBe(400);
		expect(none.data.error).toMatch(/choose a station/i);

		const foreign = await station(hotelB.id, 'Elsewhere');
		const wrong = await deleteStation(asUser(hotelA, MANAGER), { stationId: grill.id, moveTo: foreign.id });
		expect(wrong.status).toBe(400);
		expect(await db.select().from(s.diningStations).where(eq(s.diningStations.id, grill.id))).toHaveLength(1);
	});

	it('is manager work, and one hotel cannot delete another’s station', async () => {
		const spare = await station(hotelA.id, 'Spare');
		await expect(deleteStation(asUser(hotelA, COOK), { stationId: spare.id })).rejects.toMatchObject({ status: 403 });

		const cross = await deleteStation(asUser(hotelB, MANAGER), { stationId: spare.id });
		expect(cross.status).toBe(400);
		expect(cross.data.error).toMatch(/not found/i);

		const ok = await deleteStation(asUser(hotelA, MANAGER), { stationId: spare.id });
		expect(ok).toEqual({ ok: 'Deleted "Spare".' });
	});
});
