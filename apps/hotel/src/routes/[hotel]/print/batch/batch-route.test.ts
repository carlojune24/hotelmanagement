import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

/** Printing several receipts/invoices in one job: only staff may, only their own hotel's, only real
 *  documents. Own throwaway hotels; skipped without a database. */
const hasDb = Boolean(process.env.DATABASE_URL) || (await hasEnvFile());

async function hasEnvFile(): Promise<boolean> {
	try {
		const { env } = await import('$env/dynamic/private');
		return Boolean(env.DATABASE_URL);
	} catch {
		return false;
	}
}

describe.skipIf(!hasDb)('batch print (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const page = await import('./+page.server');
	const o = await import('$lib/server/dining-orders');
	const { seedFinanceDefaults } = await import('$lib/server/finance/seed-defaults');
	const { createDocumentSeries } = await import('$lib/server/finance/documents');

	const tag = `batchtest-${Math.random().toString(36).slice(2, 10)}`;
	const hotelIds: string[] = [];
	let hotelA: any;
	let hotelB: any;
	let ids: string[] = [];

	async function mkHotel(suffix: string) {
		const [h] = await db.insert(s.hotels).values({ slug: `${tag}-${suffix}`, name: `Batch test ${suffix}`, orgRef: mintRef('org') }).returning();
		hotelIds.push(h!.id);
		return h!;
	}
	const as = (hotel: any, caps: string[] | null) =>
		({ hotel, user: caps ? { id: 'u', isPlatformAdmin: false } : null, role: caps ? { id: 'r', slug: 'r', name: 'R', isProtected: false, capabilities: caps } : null }) as never;
	const load = (locals: never, list: string[], search = '') =>
		page.load({ locals, url: new URL(`http://x/?ids=${list.join(',')}${search}`) } as never) as Promise<any>;

	beforeAll(async () => {
		hotelA = await mkHotel('a');
		hotelB = await mkHotel('b');
		await seedFinanceDefaults(db, hotelA.id);
		await createDocumentSeries(hotelA.id, { type: 'official_receipt', prefix: 'OR', serialFrom: 1, serialTo: 20, atpOrPermitNo: null, dateRegistered: null, accreditedPrinter: null, accreditationNo: null, notes: null }, null);
		const [v] = await db.insert(s.diningItems).values({ hotelId: hotelA.id, title: 'Cafe' }).returning();
		const [dish] = await db.insert(s.diningMenuItems).values({ hotelId: hotelA.id, diningItemId: v!.id, name: 'Soda', priceCentavos: 8_000 }).returning();
		for (let i = 0; i < 2; i++) {
			const placed = await o.createDiningOrder({ hotelId: hotelA.id, venueId: v!.id, orderType: 'takeaway', source: 'staff', lines: [{ menuItemId: dish!.id, quantity: 1 }] });
			const paid = await o.payDiningOrder({ hotelId: hotelA.id, orderId: placed.id, method: 'card', documents: 'or' });
			ids.push(paid.documents[0]!.id);
		}
	});

	afterAll(async () => {
		if (hotelIds.length) await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
	});

	it('returns every document in the order asked for, thermal by default', async () => {
		const out = await load(as(hotelA, ['dining:read']), [ids[1]!, ids[0]!]);
		expect(out.docs.map((d: any) => d.snapshot.document.formattedNo)).toEqual(['OR-000002', 'OR-000001']);
		expect(out.format).toBe('thermal');
		expect((await load(as(hotelA, ['folio:read']), ids, '&format=a4')).format).toBe('a4');
	});

	it('is staff only', async () => {
		await expect(load(as(hotelA, null), ids)).rejects.toMatchObject({ status: 403 });
		await expect(load(as(hotelA, ['housekeeping:read']), ids)).rejects.toMatchObject({ status: 403 });
	});

	it('never shows another hotel\'s documents, a made-up id, or an empty list', async () => {
		await expect(load(as(hotelB, ['dining:read']), ids)).rejects.toMatchObject({ status: 404 });
		await expect(load(as(hotelA, ['dining:read']), [ids[0]!, crypto.randomUUID()])).rejects.toMatchObject({ status: 404 });
		await expect(load(as(hotelA, ['dining:read']), [])).rejects.toMatchObject({ status: 404 });
		await expect(load(as(hotelA, ['dining:read']), ['nope'])).rejects.toMatchObject({ status: 404 });
	});

	it('leaves out a document that was spoiled', async () => {
		await db.update(s.documents).set({ status: 'spoiled' }).where(eq(s.documents.id, ids[0]!));
		await expect(load(as(hotelA, ['dining:read']), ids)).rejects.toMatchObject({ status: 404 });
		await db.update(s.documents).set({ status: 'issued' }).where(eq(s.documents.id, ids[0]!));
	});
});
