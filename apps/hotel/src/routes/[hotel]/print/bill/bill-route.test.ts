import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

/** The printed guest bill: who may open it, what it adds up to, and that printing it issues nothing
 *  official. Own throwaway hotels; skipped without a database. */
const hasDb = Boolean(process.env.DATABASE_URL) || (await hasEnvFile());

async function hasEnvFile(): Promise<boolean> {
	try {
		const { env } = await import('$env/dynamic/private');
		return Boolean(env.DATABASE_URL);
	} catch {
		return false;
	}
}

describe.skipIf(!hasDb)('dining guest bill (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const checkPage = await import('./check/[checkId]/+page.server');
	const orderPage = await import('./order/[orderId]/+page.server');
	const o = await import('$lib/server/dining-orders');
	const { seedFinanceDefaults } = await import('$lib/server/finance/seed-defaults');

	const tag = `billtest-${Math.random().toString(36).slice(2, 10)}`;
	const hotelIds: string[] = [];
	let hotelA: any;
	let hotelB: any;
	let checkId = '';
	let takeawayId = '';
	let paidOrderId = '';

	async function mkHotel(suffix: string) {
		const [h] = await db.insert(s.hotels).values({ slug: `${tag}-${suffix}`, name: `Bill test ${suffix}`, orgRef: mintRef('org') }).returning();
		hotelIds.push(h!.id);
		return h!;
	}
	const as = (hotel: any, caps: string[] | null) =>
		({ hotel, user: caps ? { id: 'u', isPlatformAdmin: false } : null, role: caps ? { id: 'r', slug: 'r', name: 'R', isProtected: false, capabilities: caps } : null }) as never;
	const loadCheck = (locals: never, id: string, search = '') =>
		checkPage.load({ locals, params: { checkId: id }, url: new URL(`http://x/${search}`) } as never) as Promise<any>;
	const loadOrder = (locals: never, id: string) =>
		orderPage.load({ locals, params: { orderId: id }, url: new URL('http://x/') } as never) as Promise<any>;

	beforeAll(async () => {
		hotelA = await mkHotel('a');
		hotelB = await mkHotel('b');
		await seedFinanceDefaults(db, hotelA.id);
		const [v] = await db.insert(s.diningItems).values({ hotelId: hotelA.id, title: 'Cafe' }).returning();
		const [table] = await db.insert(s.diningTables).values({ hotelId: hotelA.id, diningItemId: v!.id, name: 'T4', seats: 4 }).returning();
		const [soda] = await db.insert(s.diningMenuItems).values({ hotelId: hotelA.id, diningItemId: v!.id, name: 'Soda', priceCentavos: 8_000 }).returning();
		const [adobo] = await db.insert(s.diningMenuItems).values({ hotelId: hotelA.id, diningItemId: v!.id, name: 'Adobo', priceCentavos: 15_000 }).returning();

		const first = await o.createDiningOrder({ hotelId: hotelA.id, venueId: v!.id, orderType: 'dine_in', tableId: table!.id, source: 'staff', lines: [{ menuItemId: soda!.id, quantity: 2 }] });
		const second = await o.createDiningOrder({ hotelId: hotelA.id, venueId: v!.id, orderType: 'dine_in', tableId: table!.id, source: 'staff', lines: [{ menuItemId: adobo!.id, quantity: 1 }] });
		paidOrderId = first.id;
		const [row] = await db.select({ checkId: s.diningOrders.checkId }).from(s.diningOrders).where(eq(s.diningOrders.id, second.id));
		checkId = row!.checkId!;
		const tk = await o.createDiningOrder({ hotelId: hotelA.id, venueId: v!.id, orderType: 'takeaway', source: 'staff', guestName: 'Gina', lines: [{ menuItemId: soda!.id, quantity: 1 }] });
		takeawayId = tk.id;
	});

	afterAll(async () => {
		if (hotelIds.length) await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
	});

	it('adds up every order on the table check', async () => {
		const { bill } = await loadCheck(as(hotelA, ['dining:read']), checkId);
		expect(bill.where).toBe('Table T4');
		expect(bill.venue).toBe('Cafe');
		expect(bill.orderCount).toBe(2);
		expect(bill.lines.map((l: any) => l.description)).toEqual(['Soda', 'Adobo']);
		expect(bill.totalCentavos).toBe(31_000);
		expect(bill.paidCentavos).toBe(0);
		expect(bill.dueCentavos).toBe(31_000);
	});

	it('shows an order that is already paid as paid, and the rest as due', async () => {
		await o.payDiningOrder({ hotelId: hotelA.id, orderId: paidOrderId, method: 'card' });
		const { bill } = await loadCheck(as(hotelA, ['dining:read']), checkId);
		expect(bill.totalCentavos).toBe(31_000);
		expect(bill.paidCentavos).toBe(16_000);
		expect(bill.dueCentavos).toBe(15_000);
	});

	it('bills a single takeaway order', async () => {
		const { bill } = await loadOrder(as(hotelA, ['dining:read']), takeawayId);
		expect(bill.where).toBe('Takeaway');
		expect(bill.guestName).toBe('Gina');
		expect(bill.totalCentavos).toBe(8_000);
	});

	it('is staff only, and never crosses hotels', async () => {
		await expect(loadCheck(as(hotelA, null), checkId)).rejects.toBeTruthy();
		await expect(loadCheck(as(hotelA, ['housekeeping:read']), checkId)).rejects.toMatchObject({ status: 403 });
		await expect(loadCheck(as(hotelB, ['dining:read']), checkId)).rejects.toMatchObject({ status: 404 });
		await expect(loadOrder(as(hotelB, ['dining:read']), takeawayId)).rejects.toMatchObject({ status: 404 });
		await expect(loadCheck(as(hotelA, ['dining:read']), crypto.randomUUID())).rejects.toMatchObject({ status: 404 });
	});

	it('issues nothing official: no document is written', async () => {
		await loadCheck(as(hotelA, ['dining:read']), checkId);
		const docs = await db.select({ id: s.documents.id }).from(s.documents).where(eq(s.documents.hotelId, hotelA.id));
		// The one paid order may have raised its own OR when it was paid; printing the bill adds none.
		const before = docs.length;
		await loadCheck(as(hotelA, ['dining:read']), checkId);
		await loadOrder(as(hotelA, ['dining:read']), takeawayId);
		const after = await db.select({ id: s.documents.id }).from(s.documents).where(eq(s.documents.hotelId, hotelA.id));
		expect(after.length).toBe(before);
	});
});
