import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';

/** Who may open a dining order's printed receipt: dining staff, finance staff, and the guest with
 *  their own order token, and nobody else. Own throwaway hotels; skipped without a database. */
const hasDb = Boolean(process.env.DATABASE_URL) || (await hasEnvFile());

async function hasEnvFile(): Promise<boolean> {
	try {
		const { env } = await import('$env/dynamic/private');
		return Boolean(env.DATABASE_URL);
	} catch {
		return false;
	}
}

describe.skipIf(!hasDb)('dining receipt print access (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const page = await import('./+page.server');
	const invoicePage = await import('../../invoice/[documentId]/+page.server');
	const o = await import('$lib/server/dining-orders');
	const { seedFinanceDefaults } = await import('$lib/server/finance/seed-defaults');
	const { createDocumentSeries, issueDiningDocument } = await import('$lib/server/finance/documents');

	const tag = `printtest-${Math.random().toString(36).slice(2, 10)}`;
	const hotelIds: string[] = [];
	let hotelA: any;
	let hotelB: any;
	let documentId = '';
	let invoiceId = '';
	let token = '';

	async function mkHotel(suffix: string) {
		const [h] = await db.insert(s.hotels).values({ slug: `${tag}-${suffix}`, name: `Print test ${suffix}`, orgRef: mintRef('org') }).returning();
		hotelIds.push(h!.id);
		return h!;
	}
	const as = (hotel: any, caps: string[] | null) =>
		({ hotel, user: caps ? { id: 'u', isPlatformAdmin: false } : null, role: caps ? { id: 'r', slug: 'r', name: 'R', isProtected: false, capabilities: caps } : null }) as never;
	const load = (locals: never, id: string, t?: string) =>
		page.load({ locals, params: { documentId: id }, url: new URL(`http://x/${t ? `?t=${t}` : ''}`) } as never) as Promise<any>;

	beforeAll(async () => {
		hotelA = await mkHotel('a');
		hotelB = await mkHotel('b');
		await seedFinanceDefaults(db, hotelA.id);
		await createDocumentSeries(hotelA.id, { type: 'official_receipt', prefix: 'OR', serialFrom: 1, serialTo: 20, atpOrPermitNo: null, dateRegistered: null, accreditedPrinter: null, accreditationNo: null, notes: null }, null);
		await createDocumentSeries(hotelA.id, { type: 'invoice', prefix: 'INV', serialFrom: 1, serialTo: 20, atpOrPermitNo: null, dateRegistered: null, accreditedPrinter: null, accreditationNo: null, notes: null }, null);
		const [v] = await db.insert(s.diningItems).values({ hotelId: hotelA.id, title: 'Cafe' }).returning();
		const [dish] = await db.insert(s.diningMenuItems).values({ hotelId: hotelA.id, diningItemId: v!.id, name: 'Soda', priceCentavos: 8_000 }).returning();
		const placed = await o.createDiningOrder({ hotelId: hotelA.id, venueId: v!.id, orderType: 'takeaway', source: 'online', guestName: 'Gina', lines: [{ menuItemId: dish!.id, quantity: 1 }] });
		token = placed.accessToken;
		await o.payDiningOrder({ hotelId: hotelA.id, orderId: placed.id, method: 'card' });
		documentId = (await o.getOrderDocuments(hotelA.id, placed.id))[0]!.id;
		invoiceId = (await issueDiningDocument(hotelA.id, placed.id, 'invoice', null)).id;
	});

	afterAll(async () => {
		if (hotelIds.length) await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
	});

	it('shows the receipt to dining staff and to finance staff', async () => {
		const out = await load(as(hotelA, ['dining:read']), documentId);
		expect(out.snapshot.document.typeLabel).toBe('Official Receipt');
		expect(out.snapshot.lines[0].description).toBe('Soda');
		expect((await load(as(hotelA, ['folio:read']), documentId)).snapshot.document.formattedNo).toMatch(/^OR-/);
	});

	it('shows it to the guest only with their own order token', async () => {
		expect((await load(as(hotelA, null), documentId, token)).snapshot.totals.amountPaidCentavos).toBe(8_000);
		await expect(load(as(hotelA, null), documentId)).rejects.toMatchObject({ status: 403 });
		await expect(load(as(hotelA, null), documentId, crypto.randomUUID())).rejects.toMatchObject({ status: 403 });
		await expect(load(as(hotelA, null), documentId, 'nope')).rejects.toMatchObject({ status: 403 });
	});

	it('is closed to staff with no dining or finance access, and to another hotel', async () => {
		await expect(load(as(hotelA, ['housekeeping:read']), documentId)).rejects.toMatchObject({ status: 403 });
		await expect(load(as(hotelB, ['dining:read']), documentId)).rejects.toMatchObject({ status: 404 });
		await expect(load(as(hotelB, null), documentId, token)).rejects.toMatchObject({ status: 404 });
	});

	it('applies the same rules to the invoice page', async () => {
		const inv = (locals: never, t?: string) =>
			invoicePage.load({ locals, params: { documentId: invoiceId }, url: new URL(`http://x/${t ? `?t=${t}` : ''}`) } as never) as Promise<any>;
		expect((await inv(as(hotelA, ['dining:read']))).snapshot.document.typeLabel).toBe('Invoice');
		expect((await inv(as(hotelA, null), token)).snapshot.document.typeLabel).toBe('Invoice');
		await expect(inv(as(hotelA, null))).rejects.toMatchObject({ status: 403 });
		await expect(inv(as(hotelA, ['housekeeping:read']))).rejects.toMatchObject({ status: 403 });
	});
});
