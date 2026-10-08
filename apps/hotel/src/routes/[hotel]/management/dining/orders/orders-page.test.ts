import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

/**
 * Live-DB tests for the Orders page's server side (load + form actions): who may do what, the
 * order JSON payload, cashier payment, voids and BIR documents. Own throwaway hotels and a
 * throwaway user, removed afterwards; skipped when no DATABASE_URL is configured.
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

describe.skipIf(!hasDb)('dining orders page: load and actions (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const page = await import('./+page.server');
	const { seedFinanceDefaults } = await import('$lib/server/finance/seed-defaults');
	const { openShift } = await import('$lib/server/finance/shifts');
	const { createDocumentSeries } = await import('$lib/server/finance/documents');
	const { businessDateFor } = await import('$lib/server/finance/shared');

	const tag = `orderspage-${Math.random().toString(36).slice(2, 10)}`;
	const hotelIds: string[] = [];
	let userId = '';
	let hotelA: Awaited<ReturnType<typeof mkHotel>>;
	let hotelB: Awaited<ReturnType<typeof mkHotel>>;
	let venueA = '';
	let adobo = '';
	let soda = '';
	let rice = '';
	let drawerId = '';

	async function mkHotel(suffix: string) {
		const [h] = await db
			.insert(s.hotels)
			.values({ slug: `${tag}-${suffix}`, name: `Orders page ${suffix}`, orgRef: mintRef('org') })
			.returning();
		hotelIds.push(h!.id);
		return h!;
	}

	const roleOf = (capabilities: string[]) => ({ id: 'r', slug: 'r', name: 'Role', isProtected: false, capabilities });
	const asUser = (hotel: { id: string; slug: string; timezone: string; vatRateBps: number }, caps: string[]) =>
		({ hotel, user: { id: userId, email: 'x@x', name: 'Tester', isPlatformAdmin: false }, role: roleOf(caps) }) as never;

	const CASHIER = ['dining:read', 'dining:write'];
	const MANAGER = ['dining:read', 'dining:write', 'dining:manage'];
	const VIEWER = ['dining:read'];

	const fd = (o: Record<string, string>) => {
		const f = new FormData();
		for (const [k, v] of Object.entries(o)) f.set(k, v);
		return f;
	};
	const act = (name: string, locals: never, body: Record<string, string>) =>
		page.actions[name]!({ locals, request: { formData: async () => fd(body) } } as never) as Promise<any>;
	const place = (locals: never, payload: unknown) => act('create', locals, { payload: JSON.stringify(payload) });
	const forbidden = { status: 403 };

	beforeAll(async () => {
		const [u] = await db
			.insert(s.users)
			.values({ email: `${tag}@example.test`, name: 'Orders page tester', passwordHash: null })
			.returning({ id: s.users.id });
		userId = u!.id;

		hotelA = await mkHotel('a');
		hotelB = await mkHotel('b');
		await seedFinanceDefaults(db, hotelA.id);
		await seedFinanceDefaults(db, hotelB.id);
		await createDocumentSeries(hotelA.id, { type: 'official_receipt', prefix: 'OR', serialFrom: 1, serialTo: 50, atpOrPermitNo: null, dateRegistered: null, accreditedPrinter: null, accreditationNo: null, notes: null }, null);
		await createDocumentSeries(hotelA.id, { type: 'invoice', prefix: 'INV', serialFrom: 1, serialTo: 50, atpOrPermitNo: null, dateRegistered: null, accreditedPrinter: null, accreditationNo: null, notes: null }, null);

		const [v] = await db.insert(s.diningItems).values({ hotelId: hotelA.id, title: 'Cafe' }).returning();
		venueA = v!.id;
		const items = await db
			.insert(s.diningMenuItems)
			.values([
				{ hotelId: hotelA.id, diningItemId: venueA, name: 'Adobo', priceCentavos: 25_000 },
				{ hotelId: hotelA.id, diningItemId: venueA, name: 'Soda', priceCentavos: 8_000, taxable: false }
			])
			.returning();
		[adobo, soda] = items.map((i) => i.id) as [string, string];
		const [g] = await db.insert(s.diningAddonGroups).values({ hotelId: hotelA.id, diningItemId: venueA, name: 'Sides', minChoices: 1, maxChoices: 1 }).returning();
		const [r] = await db.insert(s.diningAddons).values({ hotelId: hotelA.id, groupId: g!.id, name: 'Rice', priceCentavos: 0 }).returning();
		rice = r!.id;
		await db.insert(s.diningMenuItemAddonGroups).values({ menuItemId: adobo, addonGroupId: g!.id });
		await db.insert(s.diningTables).values({ hotelId: hotelA.id, diningItemId: venueA, name: 'T1', seats: 4 });

		const settings = await db.select().from(s.financeSettings).where(eq(s.financeSettings.hotelId, hotelA.id));
		drawerId = settings[0]!.defaultDrawerAccountId!;
	});

	afterAll(async () => {
		if (hotelIds.length) await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
		if (userId) await db.delete(s.users).where(eq(s.users.id, userId));
	});

	it('shows a role only what it may do, and nobody without dining access anything', async () => {
		const load = (caps: string[], hotel = hotelA) =>
			page.load({ locals: asUser(hotel, caps), url: new URL('http://x/'), depends: () => {} } as never) as Promise<any>;
		const cashier = await load(CASHIER);
		expect(cashier).toMatchObject({ canWrite: true, canVoid: false, shiftOpen: false });
		expect(Object.keys(cashier.menus)).toEqual([venueA]);
		expect(cashier.tables.map((t: any) => t.name)).toEqual(['T1']);
		expect(await load(MANAGER)).toMatchObject({ canWrite: true, canVoid: true });
		expect(await load(VIEWER)).toMatchObject({ canWrite: false, canVoid: false });
		await expect(load([])).rejects.toMatchObject(forbidden);
		// the other hotel's board is separate
		expect((await load(CASHIER, hotelB)).orders).toEqual([]);
	});

	it('places an order from the JSON payload, and refuses a viewer, bad JSON and bad choices', async () => {
		const cashier = asUser(hotelA, CASHIER);
		const ok = await place(cashier, { venueId: venueA, orderType: 'dine_in', lines: [{ menuItemId: adobo, quantity: 2, addonIds: [rice], remarks: 'no onions' }, { menuItemId: soda, quantity: 1 }] });
		expect(ok.ok).toMatch(/^Order DN-/);
		expect(ok.placed.id).toBeTruthy();

		await expect(place(asUser(hotelA, VIEWER), { venueId: venueA, orderType: 'dine_in', lines: [{ menuItemId: soda, quantity: 1 }] })).rejects.toMatchObject(forbidden);
		expect((await act('create', cashier, { payload: '{not json' })).status).toBe(400);
		expect((await place(cashier, { venueId: venueA, orderType: 'dine_in', lines: [] })).data.error).toMatch(/at least one item/i);
		expect((await place(cashier, { venueId: venueA, orderType: 'dine_in', lines: [{ menuItemId: adobo, quantity: 1 }] })).data.error).toMatch(/choose an option for "Sides"/); // required add-on missing
		expect((await place(cashier, { venueId: venueA, orderType: 'delivery', lines: [{ menuItemId: soda, quantity: 1 }] })).status).toBe(400); // unknown order type
	});

	it("keeps another hotel's orders out of reach", async () => {
		const placed = await place(asUser(hotelA, CASHIER), { venueId: venueA, orderType: 'takeaway', lines: [{ menuItemId: soda, quantity: 1 }] });
		const intruder = asUser(hotelB, CASHIER);
		expect((await act('advance', intruder, { orderId: placed.placed.id, to: 'preparing' })).data.error).toMatch(/could not be found/);
		expect((await act('cancel', intruder, { orderId: placed.placed.id, reason: 'x' })).data.error).toMatch(/could not be found/);
		expect((await act('pay', intruder, { orderId: placed.placed.id, method: 'card' })).data.error).toMatch(/could not be found/);
	});

	it('moves an order through the kitchen and enforces the cancel rules', async () => {
		const cashier = asUser(hotelA, CASHIER);
		const { placed } = await place(cashier, { venueId: venueA, orderType: 'dine_in', lines: [{ menuItemId: soda, quantity: 1 }] });
		expect((await act('advance', cashier, { orderId: placed.id, to: 'served' })).data.error).toMatch(/can't be marked/);
		expect((await act('advance', cashier, { orderId: placed.id, to: 'preparing' })).moved).toBe(true);
		expect((await act('advance', asUser(hotelA, VIEWER), { orderId: placed.id, to: 'ready' }).catch((e) => e)).status).toBe(403);
		expect((await act('cancel', cashier, { orderId: placed.id, reason: '  ' })).status).toBe(400);
		expect((await act('cancel', cashier, { orderId: placed.id, reason: 'Guest left' })).ok).toBe('Order cancelled.');
	});

	it('takes payment: cash needs a shift and enough tender, other methods need neither', async () => {
		const cashier = asUser(hotelA, CASHIER);
		const { placed } = await place(cashier, { venueId: venueA, orderType: 'dine_in', lines: [{ menuItemId: adobo, quantity: 1, addonIds: [rice] }] }); // ₱250.00
		expect((await act('pay', cashier, { orderId: placed.id, method: 'cash', tenderedPhp: '300' })).data.error).toMatch(/Open a cashier shift/);
		expect((await act('pay', cashier, { orderId: placed.id, method: 'crypto' })).status).toBe(400);

		await openShift({ hotelId: hotelA.id, cashAccountId: drawerId, businessDate: businessDateFor('Asia/Manila'), openingFloatCentavos: 0, actor: null });
		expect((await act('pay', cashier, { orderId: placed.id, method: 'cash', tenderedPhp: '200' })).data.error).toMatch(/must cover the total/);
		const paid = await act('pay', cashier, { orderId: placed.id, method: 'cash', tenderedPhp: '300' });
		expect(paid.paid).toMatchObject({ orderId: placed.id, changeCentavos: 5_000 });
		expect(paid.paid.receiptId).toBeTruthy(); // official receipt issued automatically
		expect((await act('pay', cashier, { orderId: placed.id, method: 'cash', tenderedPhp: '300' })).data.error).toMatch(/already paid/);

		const card = await place(cashier, { venueId: venueA, orderType: 'dine_in', lines: [{ menuItemId: soda, quantity: 1 }] });
		expect((await act('pay', cashier, { orderId: card.placed.id, method: 'gcash' })).paid.changeCentavos).toBe(0);
	});

	it('lets only a manager void a payment, and the board then shows the order unpaid', async () => {
		const cashier = asUser(hotelA, CASHIER);
		const manager = asUser(hotelA, MANAGER);
		const { placed } = await place(cashier, { venueId: venueA, orderType: 'dine_in', lines: [{ menuItemId: soda, quantity: 1 }] });
		await act('pay', cashier, { orderId: placed.id, method: 'card' });

		expect((await act('voidPayment', cashier, { orderId: placed.id, reason: 'Wrong amount' }).catch((e) => e)).status).toBe(403);
		expect((await act('voidPayment', manager, { orderId: placed.id, reason: ' ' })).status).toBe(400);
		expect((await act('voidPayment', manager, { orderId: placed.id, reason: 'Wrong amount' })).ok).toMatch(/Payment voided/);

		const board = (await page.load({ locals: manager, url: new URL('http://x/'), depends: () => {} } as never)) as any;
		const o = board.orders.find((x: any) => x.id === placed.id);
		expect(o).toMatchObject({ paymentStatus: 'unpaid' });
		expect(o.documents).toEqual([]); // the receipt was cancelled with the payment
	});

	it('issues an invoice with bill-to details, and a receipt only once paid', async () => {
		const cashier = asUser(hotelA, CASHIER);
		const { placed } = await place(cashier, { venueId: venueA, orderType: 'dine_in', lines: [{ menuItemId: soda, quantity: 2 }] });
		expect((await act('issueDocument', cashier, { orderId: placed.id, type: 'official_receipt' })).data.error).toMatch(/Take payment/);

		const inv = await act('issueDocument', cashier, { orderId: placed.id, type: 'invoice', billToName: 'Acme Corp', billToTin: '123-456-789' });
		expect(inv.issued).toMatchObject({ type: 'invoice' });
		expect(inv.issued.formattedNo).toMatch(/^INV-\d+$/);
		expect((await act('issueDocument', cashier, { orderId: placed.id, type: 'invoice' })).issued.id).toBe(inv.issued.id); // same one, not a second number

		const board = (await page.load({ locals: cashier, url: new URL('http://x/'), depends: () => {} } as never)) as any;
		expect(board.orders.find((x: any) => x.id === placed.id).documents.map((d: any) => d.type)).toEqual(['invoice']);
	});
});
