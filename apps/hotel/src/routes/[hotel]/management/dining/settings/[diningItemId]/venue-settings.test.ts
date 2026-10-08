import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

/**
 * Live-DB tests for the venue settings actions: table reservations and online ordering. Who may
 * save them, what they refuse (and why), and what ends up stored. PayMongo's connection check is
 * faked. Own throwaway hotels; skipped without a database.
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

const mocks = vi.hoisted(() => ({ state: { payOnline: true } }));
vi.mock('$lib/server/paymongo/client', async (orig) => ({
	...(await orig<typeof import('$lib/server/paymongo/client')>()),
	isOnlinePaymentEnabled: vi.fn(async () => mocks.state.payOnline)
}));

describe.skipIf(!hasDb)('venue settings actions (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const page = await import('./+page.server');

	const tag = `venuesettings-${Math.random().toString(36).slice(2, 10)}`;
	const hotelIds: string[] = [];
	let hotelA: any;
	let hotelB: any;
	let venue = '';
	let emptyVenue = '';
	let otherHotelVenue = '';
	let userId = '';

	async function mkHotel(suffix: string) {
		const [h] = await db.insert(s.hotels).values({ slug: `${tag}-${suffix}`, name: `Venue settings ${suffix}`, orgRef: mintRef('org') }).returning();
		hotelIds.push(h!.id);
		return h!;
	}
	const as = (hotel: any, caps: string[]) =>
		({ hotel, user: { id: userId, email: 'x@x', name: 'Tester', isPlatformAdmin: false }, role: { id: 'r', slug: 'r', name: 'R', isProtected: false, capabilities: caps } }) as never;
	const ADMIN = ['hotel:admin'];
	const fd = (o: Record<string, string>) => {
		const f = new FormData();
		for (const [k, v] of Object.entries(o)) f.set(k, v);
		return f;
	};
	const act = (name: 'updateOnlineOrdering' | 'updateReservations', locals: never, venueId: string, body: Record<string, string>) =>
		page.actions[name]!({ locals, params: { diningItemId: venueId }, request: { formData: async () => fd(body) } } as never) as Promise<any>;
	const row = async (id: string) => (await db.select().from(s.diningItems).where(eq(s.diningItems.id, id)))[0]!;

	const onlineOk = { onlineOrdersEnabled: 'on', onlinePayment: 'online_only', orderOpen: '10:00', orderClose: '20:00', prepMinutes: '20', pickupNote: 'Collect at the counter' };
	const resOk = { reservationsEnabled: 'on', seatingOpen: '11:00', lastSeating: '20:00', slotMinutes: '30', turnMinutes: '90', maxPartySize: '8', advanceDays: '60', minNoticeMinutes: '60' };

	beforeAll(async () => {
		const [u] = await db.insert(s.users).values({ email: `${tag}@example.test`, name: 'Venue settings tester', passwordHash: null }).returning({ id: s.users.id });
		userId = u!.id;
		hotelA = await mkHotel('a');
		hotelB = await mkHotel('b');
		const [v] = await db.insert(s.diningItems).values({ hotelId: hotelA.id, title: 'Cafe' }).returning();
		const [e] = await db.insert(s.diningItems).values({ hotelId: hotelA.id, title: 'No menu yet' }).returning();
		const [b] = await db.insert(s.diningItems).values({ hotelId: hotelB.id, title: 'Other' }).returning();
		venue = v!.id;
		emptyVenue = e!.id;
		otherHotelVenue = b!.id;
		await db.insert(s.diningMenuItems).values({ hotelId: hotelA.id, diningItemId: venue, name: 'Adobo', priceCentavos: 25_000 });
		await db.insert(s.diningTables).values({ hotelId: hotelA.id, diningItemId: venue, name: 'T1', seats: 4 });
	});

	afterAll(async () => {
		if (hotelIds.length) await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
		if (userId) await db.delete(s.users).where(eq(s.users.id, userId));
	});

	beforeEach(() => {
		mocks.state.payOnline = true;
	});

	// ---- online ordering ---------------------------------------------------------------

	it('saves online ordering and stores every setting', async () => {
		const out = await act('updateOnlineOrdering', as(hotelA, ADMIN), venue, onlineOk);
		expect(out.ok).toBe('Online ordering is on.');
		expect(await row(venue)).toMatchObject({ onlineOrdersEnabled: true, onlinePayment: 'online_only', orderOpen: '10:00', orderClose: '20:00', prepMinutes: 20, pickupNote: 'Collect at the counter' });
		const off = await act('updateOnlineOrdering', as(hotelA, ADMIN), venue, { ...onlineOk, onlineOrdersEnabled: '' });
		expect(off.ok).toBe('Online ordering settings saved.');
		expect((await row(venue)).onlineOrdersEnabled).toBe(false);
	});

	it('only lets a hotel admin change it, and only on its own venue', async () => {
		await expect(act('updateOnlineOrdering', as(hotelA, ['dining:manage']), venue, onlineOk)).rejects.toMatchObject({ status: 403 });
		// An admin of another hotel is refused (it has no dishes there, or the venue is not found) and nothing changes.
		const before = await row(venue);
		expect([400, 404]).toContain((await act('updateOnlineOrdering', as(hotelB, ADMIN), venue, onlineOk)).status);
		expect([400, 404]).toContain((await act('updateOnlineOrdering', as(hotelA, ADMIN), otherHotelVenue, onlineOk)).status);
		expect((await row(venue)).updatedAt).toEqual(before.updatedAt);
		expect((await row(otherHotelVenue)).onlineOrdersEnabled).toBe(false);
	});

	it('will not turn ordering on without hours, a menu, or a way to pay, and says why', async () => {
		const a = as(hotelA, ADMIN);
		expect((await act('updateOnlineOrdering', a, venue, { ...onlineOk, orderOpen: '' })).data.error).toMatch(/first and last pickup/);
		expect((await act('updateOnlineOrdering', a, venue, { ...onlineOk, orderClose: '09:00' })).data.error).toMatch(/after the first/);
		expect((await act('updateOnlineOrdering', a, venue, { ...onlineOk, orderClose: '10:00' })).data.error).toMatch(/after the first/); // equal is not a window
		expect((await act('updateOnlineOrdering', a, emptyVenue, onlineOk)).data.error).toMatch(/Add dishes/);
		mocks.state.payOnline = false;
		expect((await act('updateOnlineOrdering', a, venue, onlineOk)).data.error).toMatch(/PayMongo/);
		// pay-at-the-restaurant needs no PayMongo
		expect((await act('updateOnlineOrdering', a, venue, { ...onlineOk, onlinePayment: 'online_or_venue' })).ok).toBe('Online ordering is on.');
		expect((await row(venue)).onlinePayment).toBe('online_or_venue');
	});

	it('validates the numbers and text it stores', async () => {
		const a = as(hotelA, ADMIN);
		expect((await act('updateOnlineOrdering', a, venue, { ...onlineOk, prepMinutes: '5' })).data.error).toMatch(/at least 10 minutes/);
		expect((await act('updateOnlineOrdering', a, venue, { ...onlineOk, prepMinutes: '500' })).data.error).toMatch(/at most 4 hours/);
		expect((await act('updateOnlineOrdering', a, venue, { ...onlineOk, prepMinutes: 'abc' })).status).toBe(400);
		expect((await act('updateOnlineOrdering', a, venue, { ...onlineOk, onlinePayment: 'free_for_all' })).status).toBe(400);
		expect((await act('updateOnlineOrdering', a, venue, { ...onlineOk, orderOpen: '25:00' })).status).toBe(400);
		expect((await act('updateOnlineOrdering', a, venue, { ...onlineOk, pickupNote: 'x'.repeat(201) })).data.error).toMatch(/under 200/);
		// switching it off needs none of the preconditions, so a broken venue can always be turned off
		expect((await act('updateOnlineOrdering', a, emptyVenue, { onlineOrdersEnabled: '', onlinePayment: 'online_only', prepMinutes: '20' })).ok).toBe('Online ordering settings saved.');
	});

	// ---- table reservations ------------------------------------------------------------

	it('saves table reservations and stores every setting', async () => {
		const out = await act('updateReservations', as(hotelA, ADMIN), venue, resOk);
		expect(out.ok).toBe('Reservations are on.');
		expect(await row(venue)).toMatchObject({ reservationsEnabled: true, seatingOpen: '11:00', lastSeating: '20:00', slotMinutes: 30, turnMinutes: 90, maxPartySize: 8, advanceDays: 60, minNoticeMinutes: 60 });
		expect((await act('updateReservations', as(hotelA, ADMIN), venue, { ...resOk, reservationsEnabled: '' })).ok).toBe('Reservation settings saved.');
	});

	it('guards table reservations the same way: admin only, own venue, preconditions, ranges', async () => {
		const a = as(hotelA, ADMIN);
		await expect(act('updateReservations', as(hotelA, ['dining:manage']), venue, resOk)).rejects.toMatchObject({ status: 403 });
		expect([400, 404]).toContain((await act('updateReservations', as(hotelB, ADMIN), venue, resOk)).status);
		expect((await row(venue)).reservationsEnabled).toBe(false);
		expect((await act('updateReservations', a, venue, { ...resOk, seatingOpen: '' })).data.error).toMatch(/first and last seating/);
		expect((await act('updateReservations', a, venue, { ...resOk, lastSeating: '10:00' })).data.error).toMatch(/after the first/);
		expect((await act('updateReservations', a, emptyVenue, resOk)).data.error).toMatch(/Add at least one table/);
		expect((await act('updateReservations', a, venue, { ...resOk, slotMinutes: '20' })).data.error).toMatch(/15, 30 or 60/);
		expect((await act('updateReservations', a, venue, { ...resOk, turnMinutes: '10' })).data.error).toMatch(/at least 30 minutes/);
		expect((await act('updateReservations', a, venue, { ...resOk, turnMinutes: '400' })).data.error).toMatch(/at most 5 hours/);
		expect((await act('updateReservations', a, venue, { ...resOk, maxPartySize: '0' })).status).toBe(400);
		expect((await act('updateReservations', a, venue, { ...resOk, advanceDays: '999' })).status).toBe(400);
	});

	it('loads the venue with its table count and PayMongo status, for admins only', async () => {
		const load = (locals: never, id: string) => page.load({ locals, params: { diningItemId: id } } as never) as Promise<any>;
		const out = await load(as(hotelA, ADMIN), venue);
		expect(out).toMatchObject({ tableCount: 1, payMongoConnected: true });
		expect(out.item.title).toBe('Cafe');
		mocks.state.payOnline = false;
		expect((await load(as(hotelA, ADMIN), venue)).payMongoConnected).toBe(false);
		await expect(load(as(hotelA, ['dining:manage']), venue)).rejects.toMatchObject({ status: 403 });
		await expect(load(as(hotelA, ADMIN), otherHotelVenue)).rejects.toMatchObject({ status: 404 });
	});
});
