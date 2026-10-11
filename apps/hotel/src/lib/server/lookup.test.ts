import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { stationIdFor } from '$lib/server/test-station';

/**
 * Live-DB tests for "Find by number": every kind of number resolves inside its own hotel, only
 * for someone who may open what it leads to, and the activity trail redacts data for non-admins.
 * Own throwaway hotels, removed afterwards; skipped when no DATABASE_URL is configured.
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

describe.skipIf(!hasDb)('find by number (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { writeAudit } = await import('./audit');
	const o = await import('./dining-orders');
	const l = await import('./lookup');

	const tag = `lookup-${Math.random().toString(36).slice(2, 8)}`;
	const hotelIds: string[] = [];
	let hotelA = '';
	let hotelB = '';
	let slugA = '';
	let orderId = '';
	let orderCode = '';
	let diningCode = '';
	let diningId = '';
	let reservationCode = '';
	const REF = 'GCASH-77421-ZX';

	const all = () => true;
	const only = (...caps: string[]) => (cap: string) => caps.includes(cap);

	async function mkHotel(suffix: string) {
		const [h] = await db
			.insert(s.hotels)
			.values({ slug: `${tag}-${suffix}`, name: `Lookup ${suffix}`, orgRef: mintRef('org') })
			.returning({ id: s.hotels.id, slug: s.hotels.slug });
		hotelIds.push(h!.id);
		return h!;
	}

	beforeAll(async () => {
		const a = await mkHotel('a');
		const b = await mkHotel('b');
		hotelA = a.id;
		hotelB = b.id;
		slugA = a.slug;

		const [g] = await db.insert(s.guests).values({ hotelId: hotelA, fullName: 'Lookup Guest', email: 'lg@example.com' }).returning();
		const [ord] = await db
			.insert(s.orders)
			.values({
				hotelId: hotelA,
				guestId: g!.id,
				status: 'confirmed',
				subtotalCentavos: 100_000,
				feesCentavos: 0,
				vatCentavos: 12_000,
				totalCentavos: 112_000,
				accessToken: randomUUID()
			})
			.returning();
		orderId = ord!.id;
		orderCode = orderId.slice(0, 8).toUpperCase();
		const [rt] = await db.insert(s.roomTypes).values({ hotelId: hotelA, name: 'Deluxe' }).returning();
		const [bk] = await db
			.insert(s.bookings)
			.values({
				hotelId: hotelA,
				orderId,
				status: 'confirmed',
				checkIn: '2031-06-10',
				checkOut: '2031-06-12',
				occupancy: 2,
				subtotalCentavos: 100_000,
				feesCentavos: 0,
				vatCentavos: 12_000,
				totalCentavos: 112_000
			})
			.returning();
		await db.insert(s.payments).values({
			orderId,
			provider: 'manual',
			status: 'paid',
			method: 'gcash',
			purpose: 'settlement',
			amountCentavos: 112_000,
			referenceNo: REF,
			paidAt: new Date()
		});
		await writeAudit({ hotelId: hotelA, actor: null, action: 'booking.check_in', entityType: 'booking', entityId: bk!.id, after: { secret: 'room 101' } });
		await writeAudit({ hotelId: hotelA, actor: null, action: 'order.manual_confirm', entityType: 'order', entityId: orderId });
		// another hotel's entry that happens to carry the same entity id must never appear
		await writeAudit({ hotelId: hotelB, actor: null, action: 'booking.check_in', entityType: 'order', entityId: orderId });

		const [v] = await db.insert(s.diningItems).values({ hotelId: hotelA, title: 'Cafe' }).returning();
		const [dish] = await db
			.insert(s.diningMenuItems)
			.values({ hotelId: hotelA, stationId: await stationIdFor(hotelA), diningItemId: v!.id, name: 'Adobo', priceCentavos: 25_000 })
			.returning();
		const d = await o.createDiningOrder({
			hotelId: hotelA,
			venueId: v!.id,
			orderType: 'takeaway',
			tableId: null,
			lines: [{ menuItemId: dish!.id, quantity: 1 }]
		} as never);
		diningCode = d.code;
		diningId = d.id;
		reservationCode = `TB-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
		await db.insert(s.diningReservations).values({
			hotelId: hotelA,
			diningItemId: v!.id,
			code: reservationCode,
			status: 'confirmed',
			guestName: 'Table Guest',
			partySize: 3,
			startsAt: new Date('2031-06-10T10:00:00Z'),
			endsAt: new Date('2031-06-10T11:30:00Z'),
			source: 'staff'
		});
	});

	afterAll(async () => {
		if (hotelIds.length) {
			await db.delete(s.auditLog).where(inArray(s.auditLog.hotelId, hotelIds));
			await db.delete(s.bookings).where(inArray(s.bookings.hotelId, hotelIds));
			await db.delete(s.orders).where(inArray(s.orders.hotelId, hotelIds));
			await db.delete(s.guests).where(inArray(s.guests.hotelId, hotelIds));
			await db.delete(s.roomTypes).where(inArray(s.roomTypes.hotelId, hotelIds));
			await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
		}
	});

	it('finds a booking by its confirmation code, in any case and from its first six characters', async () => {
		for (const q of [orderCode, orderCode.toLowerCase(), orderCode.slice(0, 6)]) {
			const hits = await l.resolveNumber(hotelA, slugA, q, all);
			const hit = hits.find((h) => h.kind === 'booking');
			expect(hit?.title).toBe(`Booking ${orderCode}`);
			expect(hit?.href).toBe(`/${slugA}/management/transactions/${orderId}`);
			expect(hit?.subtitle).toContain('Lookup Guest');
		}
	});

	it('finds a dining order with or without its DN- prefix, and a table reservation by TB-', async () => {
		const full = await l.resolveNumber(hotelA, slugA, diningCode, all);
		expect(full[0]).toMatchObject({ kind: 'dining_order', href: `/${slugA}/print/bill/order/${diningId}` });
		const bare = await l.resolveNumber(hotelA, slugA, diningCode.slice(3), all);
		expect(bare.some((h) => h.kind === 'dining_order')).toBe(true);

		const res = await l.resolveNumber(hotelA, slugA, reservationCode.toLowerCase(), all);
		expect(res[0]).toMatchObject({ kind: 'dining_reservation', title: `Table reservation ${reservationCode}` });
	});

	it('finds a payment by the reference typed at the till, matched literally', async () => {
		const hits = await l.resolveNumber(hotelA, slugA, REF.toLowerCase(), all);
		expect(hits[0]).toMatchObject({ kind: 'payment_ref', href: `/${slugA}/management/transactions/${orderId}` });
		// wildcard characters are text, not patterns
		expect(await l.resolveNumber(hotelA, slugA, 'GCASH-%', all)).toEqual([]);
		expect(await l.resolveNumber(hotelA, slugA, '%%%', all)).toEqual([]);
	});

	it('returns nothing for another hotel, and for too-short or unknown numbers', async () => {
		expect(await l.resolveNumber(hotelB, `${tag}-b`, orderCode, all)).toEqual([]);
		expect(await l.resolveNumber(hotelB, `${tag}-b`, diningCode, all)).toEqual([]);
		expect(await l.resolveNumber(hotelA, slugA, 'ab', all)).toEqual([]);
		expect(await l.resolveNumber(hotelA, slugA, 'ZZZZZZZZ', all)).toEqual([]);
	});

	it("leaves out what the caller's role cannot open, so a number never confirms it exists", async () => {
		expect(await l.resolveNumber(hotelA, slugA, orderCode, only('dining:read'))).toEqual([]);
		expect(await l.resolveNumber(hotelA, slugA, REF, only('dining:read'))).toEqual([]);
		expect(await l.resolveNumber(hotelA, slugA, diningCode, only('booking:read'))).toEqual([]);
		expect((await l.resolveNumber(hotelA, slugA, orderCode, only('booking:read'))).length).toBe(1);
	});

	it("builds the booking's trail across its lines, scoped to the hotel, redacted unless admin", async () => {
		const [hit] = await l.resolveNumber(hotelA, slugA, orderCode, all);
		const refTypes = hit!.refs.map((r) => r.entityType);
		expect(refTypes).toEqual(expect.arrayContaining(['order', 'booking', 'payment']));

		const plain = await l.auditTrail(hotelA, hit!.refs, { details: false });
		expect(plain.map((e) => e.action).sort()).toEqual(['booking.check_in', 'order.manual_confirm']);
		expect(plain.every((e) => e.before === null && e.after === null)).toBe(true);

		const admin = await l.auditTrail(hotelA, hit!.refs, { details: true });
		expect(admin.find((e) => e.action === 'booking.check_in')!.after).toEqual({ secret: 'room 101' });

		// the same entity id recorded under another hotel is not part of this hotel's trail
		expect((await l.auditTrail(hotelB, hit!.refs, { details: true })).length).toBe(1);
		expect(await l.auditTrail(hotelA, [], { details: true })).toEqual([]);
	});
});
