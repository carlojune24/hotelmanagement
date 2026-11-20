import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';

/**
 * Live-DB: a hotel with no invoice series (not yet BIR-registered) gets an unnumbered Statement of
 * Account from the Invoice button instead of a 409, and nothing is persisted; once a series exists
 * the same button issues the numbered Invoice. Own throwaway hotel; skipped when no DATABASE_URL.
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

describe.skipIf(!hasDb)('invoice print falls back to a Statement of Account (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { createDocumentSeries } = await import('$lib/server/finance/documents');
	const page = await import('./+page.server');

	const tag = `soa-${Math.random().toString(36).slice(2, 10)}`;
	let hotelId = '';
	let userId = '';

	afterAll(async () => {
		if (!hotelId) return;
		const ids = [hotelId];
		await db.delete(s.documents).where(inArray(s.documents.hotelId, ids));
		await db.delete(s.documentSeries).where(inArray(s.documentSeries.hotelId, ids));
		const folioIds = (await db.select({ id: s.folios.id }).from(s.folios).where(inArray(s.folios.hotelId, ids))).map((r) => r.id);
		if (folioIds.length) await db.delete(s.folioCharges).where(inArray(s.folioCharges.folioId, folioIds));
		await db.delete(s.folios).where(inArray(s.folios.hotelId, ids));
		const bookingIds = (await db.select({ id: s.bookings.id }).from(s.bookings).where(inArray(s.bookings.hotelId, ids))).map((r) => r.id);
		if (bookingIds.length) await db.delete(s.bookingRooms).where(inArray(s.bookingRooms.bookingId, bookingIds));
		await db.delete(s.bookings).where(inArray(s.bookings.hotelId, ids));
		await db.delete(s.orders).where(inArray(s.orders.hotelId, ids));
		await db.delete(s.guests).where(inArray(s.guests.hotelId, ids));
		await db.delete(s.ratePlans).where(inArray(s.ratePlans.hotelId, ids));
		await db.delete(s.roomTypes).where(inArray(s.roomTypes.hotelId, ids));
		await db.delete(s.birSettings).where(inArray(s.birSettings.hotelId, ids));
		await db.delete(s.hotels).where(inArray(s.hotels.id, ids));
		if (userId) await db.delete(s.users).where(eq(s.users.id, userId));
	});

	it('prints an unnumbered statement with no series, then the real invoice once one exists', async () => {
		const [h] = await db.insert(s.hotels).values({ slug: tag, name: 'SOA hotel', orgRef: mintRef('org') }).returning();
		hotelId = h!.id;
		const [rt] = await db.insert(s.roomTypes).values({ hotelId, name: 'Std' }).returning();
		const [plan] = await db.insert(s.ratePlans).values({ hotelId, roomTypeId: rt!.id, name: 'Rack', basePriceCentavos: 100_000 }).returning();
		const [g] = await db.insert(s.guests).values({ hotelId, fullName: 'SOA Guest', email: 'g@example.test' }).returning();
		const [o] = await db
			.insert(s.orders)
			.values({ hotelId, guestId: g!.id, status: 'confirmed', subtotalCentavos: 0, feesCentavos: 0, vatCentavos: 0, totalCentavos: 0, accessToken: randomUUID() })
			.returning();
		const [b] = await db
			.insert(s.bookings)
			.values({ hotelId, orderId: o!.id, status: 'confirmed', checkIn: '2031-06-10', checkOut: '2031-06-12', occupancy: 2, subtotalCentavos: 0, feesCentavos: 0, vatCentavos: 0, totalCentavos: 0 })
			.returning();
		await db.insert(s.bookingRooms).values({ bookingId: b!.id, roomTypeId: rt!.id, ratePlanId: plan!.id, quantity: 1 } as never);

		const [u] = await db.insert(s.users).values({ email: `${tag}@example.test`, name: 'Desk', passwordHash: null }).returning();
		userId = u!.id;
		const locals = {
			hotel: h,
			user: { id: userId, email: 'x@x', name: 'Desk', isPlatformAdmin: true },
			role: null
		} as never;
		const load = async () =>
			(await page.load({ locals, params: { kind: 'booking', id: b!.id }, url: new URL('http://x/') } as never)) as {
				snapshot: { document: { type: string; typeLabel: string; formattedNo: string }; bir: { configured: boolean } };
			};

		const soa = await load();
		expect(soa.snapshot.document).toMatchObject({ type: 'invoice', typeLabel: 'Statement of Account', formattedNo: '' });
		expect(soa.snapshot.bir.configured).toBe(false);
		expect(await db.select().from(s.documents).where(eq(s.documents.hotelId, hotelId))).toHaveLength(0);

		await createDocumentSeries(hotelId, { type: 'invoice', prefix: 'INV', serialFrom: 1, serialTo: 20, atpOrPermitNo: null, dateRegistered: null, accreditedPrinter: null, accreditationNo: null, notes: null }, null);
		const inv = await load();
		expect(inv.snapshot.document.typeLabel).toBe('Invoice');
		expect(inv.snapshot.document.formattedNo).not.toBe('');
	});
});
