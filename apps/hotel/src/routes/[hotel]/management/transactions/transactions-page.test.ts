import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';

/**
 * Live-DB tests for the Booking transactions register's CSV and print data: same range and search
 * as the list, online vs desk, tender and references, role gate, and no other hotel's bookings.
 * Own throwaway hotels and user, removed afterwards; skipped when no DATABASE_URL.
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

describe.skipIf(!hasDb)('booking transactions: CSV and print (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const csv = await import('./csv/+server');
	const printPage = await import('../../print/transactions/+page.server');

	const tag = `bookingtxn-${Math.random().toString(36).slice(2, 10)}`;
	const hotelIds: string[] = [];
	let userId = '';
	let hotelA: Awaited<ReturnType<typeof mkHotel>>;
	let hotelB: Awaited<ReturnType<typeof mkHotel>>;
	let onlineCode = '';
	let deskCode = '';

	async function mkHotel(suffix: string) {
		const [h] = await db
			.insert(s.hotels)
			.values({ slug: `${tag}-${suffix}`, name: `Booking txn ${suffix}`, orgRef: mintRef('org') })
			.returning();
		hotelIds.push(h!.id);
		return h!;
	}

	const roleOf = (capabilities: string[]) => ({ id: 'r', slug: 'r', name: 'Role', isProtected: false, capabilities });
	const asUser = (hotel: { id: string; slug: string; timezone: string; vatRateBps: number }, caps: string[]) =>
		({ hotel, user: { id: userId, email: 'x@x', name: 'Tester', isPlatformAdmin: false }, role: roleOf(caps) }) as never;
	const get = (locals: never, qs: string) =>
		csv.GET({ locals, url: new URL(`http://localhost/transactions/csv?${qs}`) } as never) as Promise<Response>;

	const RANGE = 'range=custom&from=2031-06-01&to=2031-06-30';
	const READER = ['booking:read'];

	async function mkBooking(
		hotelId: string,
		guestName: string,
		opts: {
			online: boolean;
			checkIn: string;
			paid?: { method: 'cash' | 'paymongo'; ref: string; amount: number };
		}
	) {
		const [g] = await db
			.insert(s.guests)
			.values({ hotelId, fullName: guestName, email: `${randomUUID().slice(0, 6)}@example.com` })
			.returning();
		const [o] = await db
			.insert(s.orders)
			.values({
				hotelId,
				guestId: g!.id,
				status: 'confirmed',
				subtotalCentavos: 100_000,
				feesCentavos: 0,
				vatCentavos: 12_000,
				totalCentavos: 112_000,
				accessToken: randomUUID(),
				paymongoCheckoutSessionId: opts.online ? `cs_${randomUUID()}` : null
			})
			.returning();
		const [rt] = await db.insert(s.roomTypes).values({ hotelId, name: 'Deluxe' }).returning();
		const [plan] = await db
			.insert(s.ratePlans)
			.values({ hotelId, roomTypeId: rt!.id, name: 'Std', basePriceCentavos: 100_000 })
			.returning();
		const [b] = await db
			.insert(s.bookings)
			.values({
				hotelId,
				orderId: o!.id,
				status: 'confirmed',
				checkIn: opts.checkIn,
				checkOut: `${opts.checkIn.slice(0, 8)}28`,
				occupancy: 2,
				subtotalCentavos: 100_000,
				feesCentavos: 0,
				vatCentavos: 12_000,
				totalCentavos: 112_000
			})
			.returning();
		await db
			.insert(s.bookingRooms)
			.values({ bookingId: b!.id, roomTypeId: rt!.id, ratePlanId: plan!.id, quantity: 1 } as never);
		if (opts.paid) {
			await db.insert(s.payments).values({
				orderId: o!.id,
				provider: opts.paid.method === 'paymongo' ? 'paymongo' : 'manual',
				status: 'paid',
				method: opts.paid.method,
				purpose: 'settlement',
				amountCentavos: opts.paid.amount,
				referenceNo: opts.paid.ref,
				paidAt: new Date()
			});
		}
		return o!.id.slice(0, 8).toUpperCase();
	}

	beforeAll(async () => {
		const [u] = await db
			.insert(s.users)
			.values({ email: `${tag}@example.test`, name: 'Txn tester', passwordHash: null })
			.returning({ id: s.users.id });
		userId = u!.id;
		hotelA = await mkHotel('a');
		hotelB = await mkHotel('b');
		onlineCode = await mkBooking(hotelA.id, 'Ana Online', {
			online: true,
			checkIn: '2031-06-10',
			paid: { method: 'paymongo', ref: 'pay_online_1', amount: 112_000 }
		});
		deskCode = await mkBooking(hotelA.id, '=cmd|calc', {
			online: false,
			checkIn: '2031-06-12',
			paid: { method: 'cash', ref: 'OR-77', amount: 50_000 }
		});
		await mkBooking(hotelA.id, 'Outside Range', { online: false, checkIn: '2031-09-10' });
		await mkBooking(hotelB.id, 'Other Hotel Guest', { online: true, checkIn: '2031-06-10' });
	});

	afterAll(async () => {
		if (hotelIds.length) {
			await db.delete(s.bookings).where(inArray(s.bookings.hotelId, hotelIds));
			await db.delete(s.orders).where(inArray(s.orders.hotelId, hotelIds));
			await db.delete(s.guests).where(inArray(s.guests.hotelId, hotelIds));
			await db.delete(s.ratePlans).where(inArray(s.ratePlans.hotelId, hotelIds));
			await db.delete(s.roomTypes).where(inArray(s.roomTypes.hotelId, hotelIds));
			await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
		}
		if (userId) await db.delete(s.users).where(eq(s.users.id, userId));
	});

	it('exports the range as a CSV attachment with online and desk bookings told apart', async () => {
		const res = await get(asUser(hotelA, READER), RANGE);
		expect(res.headers.get('content-type')).toMatch(/text\/csv/);
		expect(res.headers.get('content-disposition')).toContain('booking-transactions-2031-06-01-to-2031-06-30.csv');
		const body = await res.text();
		const lines = body.slice(1).split('\r\n');

		const online = lines.find((l) => l.startsWith(onlineCode))!;
		expect(online).toContain('Ana Online');
		expect(online).toContain(',Online,paymongo,pay_online_1,');
		const desk = lines.find((l) => l.startsWith(deskCode))!;
		expect(desk).toContain(',Walk-in / staff,cash,OR-77,');
		expect(desk).toContain(`'=cmd|calc`); // a formula typed as a name stays text

		expect(body).not.toContain('Outside Range');
		expect(body).not.toContain('Other Hotel Guest');
		expect(lines.at(-1)!.startsWith('Total,,2 bookings')).toBe(true);
	});

	it('narrows by the same search as the list', async () => {
		const body = await (await get(asUser(hotelA, READER), `${RANGE}&q=online`)).text();
		expect(body).toContain('Ana Online');
		expect(body).not.toContain('cmd|calc');
	});

	it('is for booking readers only', async () => {
		await expect(get(asUser(hotelA, ['dining:read']), RANGE)).rejects.toMatchObject({ status: 403 });
		await expect(get(asUser(hotelA, []), RANGE)).rejects.toMatchObject({ status: 403 });
	});

	it('serves the same rows to the printed register, with the same gate', async () => {
		const url = new URL(`http://localhost/print/transactions?${RANGE}`);
		const data = (await printPage.load({ locals: asUser(hotelA, READER), url } as never)) as {
			rows: { code: string }[];
			range: { from: string; to: string };
		};
		expect(data.rows.map((r) => r.code).sort()).toEqual([onlineCode, deskCode].sort());
		expect(data.range).toMatchObject({ from: '2031-06-01', to: '2031-06-30' });
		await expect(
			printPage.load({ locals: asUser(hotelA, ['dining:read']), url } as never)
		).rejects.toMatchObject({ status: 403 });
	});
});
