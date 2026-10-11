import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stationIdFor } from '$lib/server/test-station';
import { eq, inArray } from 'drizzle-orm';

/**
 * Live-DB tests for the Floor's "guests changed tables" action: who may run it, what comes back
 * for the toast and the panel, and that another hotel's tab is out of reach. The move rules
 * themselves are covered in `dining-checks.test.ts`. Own throwaway hotels and user, removed
 * afterwards; skipped when no DATABASE_URL is configured.
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

describe.skipIf(!hasDb)('dining floor: move guests action (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const page = await import('./+page.server');
	const orders = await import('$lib/server/dining-orders');
	const checks = await import('$lib/server/dining-checks');

	const tag = `floormove-${Math.random().toString(36).slice(2, 10)}`;
	const hotelIds: string[] = [];
	let userId = '';
	let hotelA: Awaited<ReturnType<typeof mkHotel>>;
	let hotelB: Awaited<ReturnType<typeof mkHotel>>;
	let venueA = '';
	let menuItem = '';
	let from = '';
	let to = '';
	let checkId = '';

	async function mkHotel(suffix: string) {
		const [h] = await db
			.insert(s.hotels)
			.values({ slug: `${tag}-${suffix}`, name: `Floor move ${suffix}`, orgRef: mintRef('org') })
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
	const moveGuests = (locals: never, body: Record<string, string>) =>
		page.actions.moveGuests!({ locals, request: { formData: async () => fd(body) } } as never) as Promise<any>;

	const CASHIER = ['dining:read', 'dining:write'];
	const VIEWER = ['dining:read'];
	const forbidden = { status: 403 };

	beforeAll(async () => {
		const [u] = await db
			.insert(s.users)
			.values({ email: `${tag}@example.test`, name: 'Floor move tester', passwordHash: null })
			.returning({ id: s.users.id });
		userId = u!.id;
		hotelA = await mkHotel('a');
		hotelB = await mkHotel('b');

		const [v] = await db.insert(s.diningItems).values({ hotelId: hotelA.id, title: 'Cafe' }).returning();
		venueA = v!.id;
		const [item] = await db
			.insert(s.diningMenuItems)
			.values({ hotelId: hotelA.id, stationId: await stationIdFor(hotelA.id), diningItemId: venueA, name: 'Adobo', priceCentavos: 25_000 })
			.returning();
		menuItem = item!.id;
		const tables = await db
			.insert(s.diningTables)
			.values([
				{ hotelId: hotelA.id, diningItemId: venueA, name: 'T1', seats: 4 },
				{ hotelId: hotelA.id, diningItemId: venueA, name: 'T2', seats: 4 }
			])
			.returning();
		[from, to] = tables.map((t) => t.id) as [string, string];
		await orders.createDiningOrder({
			hotelId: hotelA.id,
			venueId: venueA,
			orderType: 'dine_in',
			tableId: from,
			lines: [{ menuItemId: menuItem, quantity: 1 }]
		});
		checkId = (await checks.getOpenCheckForTable(hotelA.id, from))!.id;
	});

	afterAll(async () => {
		if (hotelIds.length) await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
		if (userId) await db.delete(s.users).where(eq(s.users.id, userId));
	});

	it('is floor work: a viewer is refused, and so is a request with nothing picked', async () => {
		await expect(moveGuests(asUser(hotelA, VIEWER), { checkId, tableId: to })).rejects.toMatchObject(forbidden);
		await expect(moveGuests(asUser(hotelA, []), { checkId, tableId: to })).rejects.toMatchObject(forbidden);
		const none = await moveGuests(asUser(hotelA, CASHIER), { checkId, tableId: '' });
		expect(none.status).toBe(400);
		expect(none.data.error).toMatch(/pick a table/i);
	});

	it("keeps another hotel's tab out of reach", async () => {
		const out = await moveGuests(asUser(hotelB, CASHIER), { checkId, tableId: to });
		expect(out.status).toBe(400);
		expect(out.data.error).toMatch(/could not be found/i);
		expect(await checks.getOpenCheckForTable(hotelA.id, from)).toBeTruthy();
	});

	it('lets a cashier move the tab and tells the panel where it went', async () => {
		const out = await moveGuests(asUser(hotelA, CASHIER), { checkId, tableId: to });
		expect(out).toEqual({ ok: 'Moved T1 to T2 (1 order).', movedTo: to });
		expect(await checks.getOpenCheckForTable(hotelA.id, from)).toBeNull();
		expect((await checks.getOpenCheckForTable(hotelA.id, to))!.id).toBe(checkId);

		// moving to where they already are is a plain message, not a crash
		const same = await moveGuests(asUser(hotelA, CASHIER), { checkId, tableId: to });
		expect(same.status).toBe(400);
		expect(same.data.error).toMatch(/already at that table/i);
	});

	describe('joining tabs', () => {
		const joinTables = (locals: never, body: Record<string, string>) =>
			page.actions.joinTables!({ locals, request: { formData: async () => fd(body) } } as never) as Promise<any>;

		let aCheck = '';
		let bCheck = '';
		let bTable = '';

		beforeAll(async () => {
			const tables = await db
				.insert(s.diningTables)
				.values([
					{ hotelId: hotelA.id, diningItemId: venueA, name: 'J1', seats: 4 },
					{ hotelId: hotelA.id, diningItemId: venueA, name: 'J2', seats: 4 }
				])
				.returning();
			const [a, b] = tables.map((t) => t.id) as [string, string];
			bTable = b;
			for (const tableId of [a, b]) {
				await orders.createDiningOrder({
					hotelId: hotelA.id,
					venueId: venueA,
					orderType: 'dine_in',
					tableId,
					lines: [{ menuItemId: menuItem, quantity: 1 }]
				});
			}
			aCheck = (await checks.getOpenCheckForTable(hotelA.id, a))!.id;
			bCheck = (await checks.getOpenCheckForTable(hotelA.id, b))!.id;
		});

		it('is floor work: a viewer is refused, and so is a request with nothing picked', async () => {
			await expect(joinTables(asUser(hotelA, VIEWER), { checkId: aCheck, intoCheckId: bCheck })).rejects.toMatchObject(forbidden);
			const none = await joinTables(asUser(hotelA, CASHIER), { checkId: aCheck, intoCheckId: '' });
			expect(none.status).toBe(400);
			expect(none.data.error).toMatch(/pick the table/i);
		});

		it("keeps another hotel's tabs out of reach", async () => {
			const out = await joinTables(asUser(hotelB, CASHIER), { checkId: aCheck, intoCheckId: bCheck });
			expect(out.status).toBe(400);
			expect(out.data.error).toMatch(/could not be found/i);
			expect((await checks.getOpenCheckForTable(hotelA.id, bTable))!.id).toBe(bCheck);
		});

		it('lets a cashier join the tabs and tells the panel which table to follow', async () => {
			const out = await joinTables(asUser(hotelA, CASHIER), { checkId: aCheck, intoCheckId: bCheck });
			expect(out).toEqual({ ok: 'Joined J1 into J2 (1 order).', movedTo: bTable });

			// the folded tab is closed, so joining it again is a plain message, not a crash
			const again = await joinTables(asUser(hotelA, CASHIER), { checkId: aCheck, intoCheckId: bCheck });
			expect(again.status).toBe(400);
			expect(again.data.error).toMatch(/already closed/i);
		});
	});
});
