import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

/**
 * Live-DB tests for the Housekeeping page's "No damages" action: who may press it, what comes back
 * for the panel, and that another hotel's room is out of reach. The sign-off rules themselves are
 * covered in `housekeeping.test.ts`. Own throwaway hotels and user, removed afterwards; skipped when
 * no DATABASE_URL is configured.
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

describe.skipIf(!hasDb)('housekeeping page: no damages action (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const page = await import('./+page.server');

	const tag = `hkpage-${Math.random().toString(36).slice(2, 8)}`;
	const hotelIds: string[] = [];
	let userId = '';
	let hotelA: Awaited<ReturnType<typeof mkHotel>>;
	let hotelB: Awaited<ReturnType<typeof mkHotel>>;
	let roomA = '';

	async function mkHotel(suffix: string) {
		const [h] = await db
			.insert(s.hotels)
			.values({ slug: `${tag}-${suffix}`, name: `HK page ${suffix}`, orgRef: mintRef('org') })
			.returning();
		hotelIds.push(h!.id);
		return h!;
	}

	const roleOf = (capabilities: string[]) => ({ id: 'r', slug: 'r', name: 'Role', isProtected: false, capabilities });
	const asUser = (hotel: { id: string; slug: string; timezone: string; vatRateBps: number }, caps: string[]) =>
		({ hotel, user: { id: userId, email: 'x@x', name: 'Rosa Cleaner', isPlatformAdmin: false }, role: roleOf(caps) }) as never;
	const fd = (o: Record<string, string>) => {
		const f = new FormData();
		for (const [k, v] of Object.entries(o)) f.set(k, v);
		return f;
	};
	const markNoDamage = (locals: never, body: Record<string, string>) =>
		page.actions.markNoDamage!({ locals, request: { formData: async () => fd(body) } } as never) as Promise<any>;

	const HOUSEKEEPER = ['housekeeping:read', 'housekeeping:write'];
	const VIEWER = ['housekeeping:read'];

	beforeAll(async () => {
		const [u] = await db
			.insert(s.users)
			.values({ email: `${tag}@example.test`, name: 'Rosa Cleaner', passwordHash: null })
			.returning({ id: s.users.id });
		userId = u!.id;
		hotelA = await mkHotel('a');
		hotelB = await mkHotel('b');
		const [rt] = await db.insert(s.roomTypes).values({ hotelId: hotelA.id, name: 'Deluxe' }).returning();
		const [room] = await db
			.insert(s.rooms)
			.values({ hotelId: hotelA.id, roomTypeId: rt!.id, roomNumber: '201' })
			.returning();
		roomA = room!.id;
	});

	afterAll(async () => {
		if (hotelIds.length) {
			await db.delete(s.housekeepingInspections).where(inArray(s.housekeepingInspections.hotelId, hotelIds));
			await db.delete(s.auditLog).where(inArray(s.auditLog.hotelId, hotelIds));
			await db.delete(s.rooms).where(inArray(s.rooms.hotelId, hotelIds));
			await db.delete(s.roomTypes).where(inArray(s.roomTypes.hotelId, hotelIds));
			await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
		}
		if (userId) await db.delete(s.users).where(eq(s.users.id, userId));
	});

	it('is housekeeping work: a viewer is refused, and so is a request with no room', async () => {
		await expect(markNoDamage(asUser(hotelA, VIEWER), { roomId: roomA })).rejects.toMatchObject({ status: 403 });
		await expect(markNoDamage(asUser(hotelA, []), { roomId: roomA })).rejects.toMatchObject({ status: 403 });
		const none = await markNoDamage(asUser(hotelA, HOUSEKEEPER), { roomId: 'not-a-uuid' });
		expect(none.status).toBe(400);
		expect(none.data.error).toMatch(/missing room/i);
	});

	it("keeps another hotel's room out of reach", async () => {
		const out = await markNoDamage(asUser(hotelB, HOUSEKEEPER), { roomId: roomA });
		expect(out.status).toBe(400);
		expect(out.data.error).toMatch(/room not found/i);
		const rows = await db.select().from(s.housekeepingInspections).where(eq(s.housekeepingInspections.roomId, roomA));
		expect(rows).toHaveLength(0);
	});

	it("signs the room off and hands the panel the new detail, with the housekeeper's name", async () => {
		const out = await markNoDamage(asUser(hotelA, HOUSEKEEPER), { roomId: roomA, note: 'tidy' });
		expect(out.roomDetail.inspection).toMatchObject({ inspectedByName: 'Rosa Cleaner', note: 'tidy' });
		// pressing it again is harmless
		const again = await markNoDamage(asUser(hotelA, HOUSEKEEPER), { roomId: roomA });
		expect(again.roomDetail.inspection).toBeTruthy();
		const rows = await db.select().from(s.housekeepingInspections).where(eq(s.housekeepingInspections.roomId, roomA));
		expect(rows).toHaveLength(1);
	});
});
