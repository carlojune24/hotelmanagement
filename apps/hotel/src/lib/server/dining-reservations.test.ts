import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';

/**
 * Live-DB tests for dining table reservations. Like the rate-plan tests they create their own
 * throwaway hotels under a random slug and delete only what they created (deleting the hotel
 * cascades to venues, tables, reservations). Skipped when no DATABASE_URL is configured.
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

describe.skipIf(!hasDb)('dining reservations (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const r = await import('./dining-reservations');

	const tag = `diningtest-${Math.random().toString(36).slice(2, 10)}`;
	const hotelIds: string[] = [];
	const TZ = 'Asia/Manila';

	async function mkHotel(suffix: string) {
		const [h] = await db
			.insert(s.hotels)
			.values({ slug: `${tag}-${suffix}`, name: `Dining test ${suffix}`, orgRef: mintRef('org') })
			.returning({ id: s.hotels.id });
		hotelIds.push(h!.id);
		return h!.id;
	}

	async function mkVenue(hotelId: string, over: Partial<typeof s.diningItems.$inferInsert> = {}) {
		const [v] = await db
			.insert(s.diningItems)
			.values({
				hotelId,
				title: 'Test venue',
				reservationsEnabled: true,
				seatingOpen: '11:00',
				lastSeating: '13:00',
				slotMinutes: 30,
				turnMinutes: 90,
				maxPartySize: 6,
				minNoticeMinutes: 0,
				advanceDays: 90,
				...over
			})
			.returning();
		return v!;
	}

	async function mkTables(hotelId: string, venueId: string, seats: number[]) {
		const rows = await db
			.insert(s.diningTables)
			.values(seats.map((n, i) => ({ hotelId, diningItemId: venueId, name: `T${i + 1}`, seats: n })))
			.returning();
		return rows;
	}

	const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

	let hotelA = '';
	let hotelB = '';

	beforeAll(async () => {
		hotelA = await mkHotel('a');
		hotelB = await mkHotel('b');
	});

	afterAll(async () => {
		if (hotelIds.length) await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
	});

	const base = (hotelId: string, venueId: string, over: Record<string, unknown> = {}) => ({
		hotelId,
		venueId,
		timezone: TZ,
		date: day(10),
		time: '12:00',
		partySize: 2,
		guestName: 'Test Guest',
		source: 'online' as const,
		...over
	});

	it('assigns the smallest free table that fits and mints a code', async () => {
		const venue = await mkVenue(hotelA);
		await mkTables(hotelA, venue.id, [2, 4, 8]);
		const a = await r.createReservation(base(hotelA, venue.id));
		expect(a.tableNames).toEqual(['T1']);
		expect(a.code).toMatch(/^TB-[A-Z2-9]{4}$/);
		const b = await r.createReservation(base(hotelA, venue.id, { partySize: 3 }));
		expect(b.tableNames).toEqual(['T2']);
	});

	it('refuses when no table is free, but allows a back-to-back booking', async () => {
		const venue = await mkVenue(hotelA);
		await mkTables(hotelA, venue.id, [4]);
		await r.createReservation(base(hotelA, venue.id, { time: '11:00' })); // holds 11:00-12:30
		await expect(r.createReservation(base(hotelA, venue.id, { time: '12:00' }))).rejects.toBeInstanceOf(
			r.ReservationError
		);
		const next = await r.createReservation(base(hotelA, venue.id, { time: '12:30' }));
		expect(next.tableNames).toEqual(['T1']);
	});

	it('enforces the online rules: party cap, offered times, venue switched on', async () => {
		const venue = await mkVenue(hotelA, { maxPartySize: 6 });
		await mkTables(hotelA, venue.id, [4]); // biggest table caps the party at 4
		await expect(r.createReservation(base(hotelA, venue.id, { partySize: 5 }))).rejects.toThrow(/up to 4/);
		await expect(r.createReservation(base(hotelA, venue.id, { time: '15:00' }))).rejects.toThrow(/no longer available/);

		const off = await mkVenue(hotelA, { reservationsEnabled: false });
		await mkTables(hotelA, off.id, [4]);
		await expect(r.createReservation(base(hotelA, off.id))).rejects.toThrow(/not taking online/);
		// staff can still book a venue that is off for online, at any time
		const staff = await r.createReservation(base(hotelA, off.id, { source: 'staff', time: '15:00' }));
		expect(staff.tableNames).toEqual(['T1']);
	});

	it('never double-books a table under concurrent requests', async () => {
		const venue = await mkVenue(hotelA);
		await mkTables(hotelA, venue.id, [4]);
		const results = await Promise.allSettled(
			['a', 'b', 'c', 'd', 'e'].map((n) => r.createReservation(base(hotelA, venue.id, { guestName: n })))
		);
		expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
		expect(results.filter((x) => x.status === 'rejected')).toHaveLength(4);
	});

	it("will not book a venue that belongs to another hotel", async () => {
		const venue = await mkVenue(hotelB);
		await mkTables(hotelB, venue.id, [4]);
		await expect(r.createReservation(base(hotelA, venue.id))).rejects.toThrow(/could not be found/);
		expect(await r.loadBookableVenue(hotelA, venue.id)).toBeNull();
	});

	it('moves through valid statuses only, and a cancelled booking frees its table', async () => {
		const venue = await mkVenue(hotelA);
		await mkTables(hotelA, venue.id, [4]);
		const a = await r.createReservation(base(hotelA, venue.id));

		await expect(
			r.setReservationStatus({ hotelId: hotelA, reservationId: a.id, to: 'completed' })
		).rejects.toThrow(/can't be marked/);
		await r.setReservationStatus({ hotelId: hotelA, reservationId: a.id, to: 'cancelled' });
		await expect(
			r.setReservationStatus({ hotelId: hotelA, reservationId: a.id, to: 'seated' })
		).rejects.toBeInstanceOf(r.ReservationError);

		const again = await r.createReservation(base(hotelA, venue.id));
		expect(again.tableNames).toEqual(['T1']);
		await r.setReservationStatus({ hotelId: hotelA, reservationId: again.id, to: 'seated' });
		await r.setReservationStatus({ hotelId: hotelA, reservationId: again.id, to: 'completed' });
	});

	it("won't change status on another hotel's reservation", async () => {
		const venue = await mkVenue(hotelA);
		await mkTables(hotelA, venue.id, [4]);
		const a = await r.createReservation(base(hotelA, venue.id));
		await expect(
			r.setReservationStatus({ hotelId: hotelB, reservationId: a.id, to: 'cancelled' })
		).rejects.toThrow(/could not be found/);
	});

	it('reassigns tables only when the new one is free', async () => {
		const venue = await mkVenue(hotelA);
		const [t1, t2] = await mkTables(hotelA, venue.id, [4, 4]);
		const a = await r.createReservation(base(hotelA, venue.id)); // T1
		const b = await r.createReservation(base(hotelA, venue.id)); // T2
		await expect(
			r.reassignReservationTables({ hotelId: hotelA, reservationId: a.id, tableIds: [t2!.id] })
		).rejects.toThrow(/already taken/);
		await r.setReservationStatus({ hotelId: hotelA, reservationId: b.id, to: 'cancelled' });
		await r.reassignReservationTables({ hotelId: hotelA, reservationId: a.id, tableIds: [t2!.id] });
		const t = await r.getReservationForGuest(hotelA, TZ, a.code, a.accessToken);
		expect(t?.tableNames).toEqual(['T2']);
		expect(t1).toBeTruthy();
	});

	it('shows a reservation to its guest only with the right code and token, in the right hotel', async () => {
		const venue = await mkVenue(hotelA);
		await mkTables(hotelA, venue.id, [4]);
		const a = await r.createReservation(base(hotelA, venue.id, { time: '12:30', guestName: 'Ticket Holder' }));
		const ok = await r.getReservationForGuest(hotelA, TZ, a.code, a.accessToken);
		expect(ok?.guestName).toBe('Ticket Holder');
		expect(ok?.local.time).toBe('12:30');
		expect(await r.getReservationForGuest(hotelA, TZ, a.code, crypto.randomUUID())).toBeNull();
		expect(await r.getReservationForGuest(hotelA, TZ, a.code, 'not-a-token')).toBeNull();
		expect(await r.getReservationForGuest(hotelB, TZ, a.code, a.accessToken)).toBeNull();
		expect((await r.getReservationForGuest(hotelA, TZ, a.code.toLowerCase(), a.accessToken))?.id).toBe(a.id);
	});

	it('reports a slot as full once every fitting table is held', async () => {
		const venue = await mkVenue(hotelA);
		await mkTables(hotelA, venue.id, [2, 4]);
		const date = day(12);
		await r.createReservation(base(hotelA, venue.id, { date, time: '12:00', partySize: 4 }));
		const slots = await r.getSlotsForDate({ hotelId: hotelA, venueId: venue.id, timezone: TZ, date, partySize: 4 });
		expect(slots.map((x) => x.time)).toEqual(['11:00', '11:30', '12:00', '12:30', '13:00']);
		expect(slots.every((x) => !x.available)).toBe(true); // 4-top held across the whole window
		const two = await r.getSlotsForDate({ hotelId: hotelA, venueId: venue.id, timezone: TZ, date, partySize: 2 });
		expect(two.every((x) => x.available)).toBe(true); // the 2-top is still free
	});
});
