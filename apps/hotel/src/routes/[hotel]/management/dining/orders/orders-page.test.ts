import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Refund proof photos written by these tests go to a throwaway folder, never the real uploads directory.
const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmhotel-orders-test-uploads-'));
process.env.UPLOADS_DIR = uploadsDir;
const filesIn = (dir: string): string[] =>
	fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesIn(path.join(dir, e.name)) : [e.name])) : [];

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
	const dining = await import('$lib/server/dining-orders');
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
		if (hotelIds.length) {
			const stays = await db.select({ id: s.bookings.id }).from(s.bookings).where(inArray(s.bookings.hotelId, hotelIds));
			if (stays.length) await db.delete(s.bookingRooms).where(inArray(s.bookingRooms.bookingId, stays.map((b) => b.id)));
			await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
		}
		if (userId) await db.delete(s.users).where(eq(s.users.id, userId));
		if (uploadsDir.startsWith(os.tmpdir())) fs.rmSync(uploadsDir, { recursive: true, force: true });
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
		expect((await act('advance', intruder, { orderId: placed.placed.id, to: 'served' })).data.error).toMatch(/could not be found/);
		expect((await act('cancel', intruder, { orderId: placed.placed.id, reason: 'x' })).data.error).toMatch(/could not be found/);
		expect((await act('pay', intruder, { orderId: placed.placed.id, method: 'card' })).data.error).toMatch(/could not be found/);
	});

	it('leaves Start and Ready to the kitchen: the Orders board can only serve a ready order', async () => {
		const cashier = asUser(hotelA, CASHIER);
		const { placed } = await place(cashier, { venueId: venueA, orderType: 'dine_in', lines: [{ menuItemId: soda, quantity: 1 }] });
		// dining staff cannot start or finish dishes from here, whatever the form says
		for (const to of ['accepted', 'preparing', 'ready']) {
			const r = await act('advance', cashier, { orderId: placed.id, to });
			expect(r.status).toBe(400);
			expect(r.data.error).toMatch(/Kitchen tab/);
		}
		// and nothing moved
		expect((await dining.getDiningOrder(hotelA.id, placed.id))!.status).toBe('new');
		// serving needs the kitchen to have finished first
		expect((await act('advance', cashier, { orderId: placed.id, to: 'served' })).data.error).toMatch(/can't be marked/);
		await dining.setStationStatus({ hotelId: hotelA.id, orderId: placed.id, to: 'preparing' });
		await dining.setStationStatus({ hotelId: hotelA.id, orderId: placed.id, to: 'ready' });
		expect((await act('advance', cashier, { orderId: placed.id, to: 'served' })).moved).toBe(true);
	});

	it('enforces the cancel rules', async () => {
		const cashier = asUser(hotelA, CASHIER);
		const { placed } = await place(cashier, { venueId: venueA, orderType: 'dine_in', lines: [{ menuItemId: soda, quantity: 1 }] });
		expect((await act('advance', asUser(hotelA, VIEWER), { orderId: placed.id, to: 'served' }).catch((e) => e)).status).toBe(403);
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

	// ---- online orders: messages, cancellation requests, refunds -------------------------

	const on = await import('$lib/server/dining-online');
	const o = await import('$lib/server/dining-orders');
	const online = () =>
		o.createDiningOrder({ hotelId: hotelA.id, venueId: venueA, orderType: 'takeaway', source: 'online', guestName: 'Online Gina', guestPhone: '09170000000', lines: [{ menuItemId: soda, quantity: 1 }] });
	const board = (locals: never) => page.load({ locals, url: new URL('http://x/'), depends: () => {} } as never) as Promise<any>;
	const actWith = (name: string, locals: never, body: Record<string, string>, file?: File) =>
		page.actions[name]!({
			locals,
			request: {
				formData: async () => {
					const f = fd(body);
					if (file) f.set('proof', file);
					return f;
				}
			}
		} as never) as Promise<any>;
	const png = () => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'receipt.png', { type: 'image/png' });

	it('opens a guest thread, marks it read, and lets staff reply', async () => {
		const cashier = asUser(hotelA, CASHIER);
		const order = await online();
		await on.postGuestMessage(hotelA.id, order.code, order.accessToken, 'Where do I collect it?');
		expect((await board(cashier)).orders.find((x: any) => x.id === order.id)).toMatchObject({ unreadMessages: 1, source: 'online' });

		const opened = await act('openThread', cashier, { orderId: order.id });
		expect(opened.thread.messages.map((m: any) => [m.direction, m.body])).toEqual([['guest', 'Where do I collect it?']]);
		expect((await board(cashier)).orders.find((x: any) => x.id === order.id).unreadMessages).toBe(0);

		expect((await act('reply', cashier, { orderId: order.id, body: 'At the counter, ground floor.' })).replied).toBe(true);
		expect((await act('openThread', cashier, { orderId: order.id })).thread.messages.at(-1)).toMatchObject({ direction: 'staff', body: 'At the counter, ground floor.' });
		expect((await act('reply', cashier, { orderId: order.id, body: '  ' })).status).toBe(400);
		expect((await act('reply', asUser(hotelA, VIEWER), { orderId: order.id, body: 'hi' }).catch((e) => e)).status).toBe(403);
		// another hotel can neither read nor answer the thread
		const intruder = asUser(hotelB, CASHIER);
		expect((await act('openThread', intruder, { orderId: order.id })).status).toBe(404);
		expect((await act('reply', intruder, { orderId: order.id, body: 'hi' })).data.error).toMatch(/could not be found/);
	});

	it('answers a cancellation request: decline keeps the order, approve cancels it and puts the money under refunds due', async () => {
		const cashier = asUser(hotelA, CASHIER);
		const order = await online();
		await act('pay', cashier, { orderId: order.id, method: 'card' });
		await on.requestDiningCancellation(hotelA.id, order.code, order.accessToken, 'Plans changed');
		expect((await board(cashier)).orders.find((x: any) => x.id === order.id)).toMatchObject({ cancelRequestNote: 'Plans changed' });

		expect((await act('respondCancel', asUser(hotelA, VIEWER), { orderId: order.id, approve: 'false' }).catch((e) => e)).status).toBe(403);
		expect((await act('respondCancel', cashier, { orderId: order.id, approve: 'maybe' })).status).toBe(400);
		const declined = await act('respondCancel', cashier, { orderId: order.id, approve: 'false', message: 'Sorry, it is already being cooked.' });
		expect(declined.ok).toMatch(/declined/);
		expect((await board(cashier)).orders.find((x: any) => x.id === order.id)).toMatchObject({ status: 'new', cancelRequestedAt: null });

		await on.requestDiningCancellation(hotelA.id, order.code, order.accessToken, 'Still cannot make it');
		expect((await act('respondCancel', cashier, { orderId: order.id, approve: 'true' })).ok).toMatch(/Order cancelled/);
		const after = await board(cashier);
		expect(after.orders.find((x: any) => x.id === order.id)).toBeUndefined(); // off the live board
		expect(after.refundDue.find((x: any) => x.id === order.id)).toMatchObject({ code: order.code, totalCentavos: 8_000, refundedCentavos: 0 });
		expect((await act('respondCancel', cashier, { orderId: order.id, approve: 'true' })).data.error).toMatch(/no cancellation request/);
	});

	it('records a refund for a manager only, keeps the proof photo, and clears the order from refunds due', async () => {
		const cashier = asUser(hotelA, CASHIER);
		const manager = asUser(hotelA, MANAGER);
		const order = await online();
		await act('pay', cashier, { orderId: order.id, method: 'card' });
		await on.requestDiningCancellation(hotelA.id, order.code, order.accessToken, 'x');
		await act('respondCancel', cashier, { orderId: order.id, approve: 'true' });
		const refund = (body: Record<string, string>, file?: File, who = manager) => actWith('recordRefund', who, { orderId: order.id, method: 'gcash', ...body }, file);

		expect((await refund({ amountPhp: '30' }, undefined, cashier).catch((e) => e)).status).toBe(403); // a cashier cannot record a refund
		expect((await refund({ amountPhp: '0' })).status).toBe(400);
		expect((await refund({ amountPhp: '30', method: 'crypto' })).data.error).toMatch(/how the refund was sent/);
		expect((await refund({ amountPhp: '30' }, new File(['hello'], 'x.txt', { type: 'text/plain' }))).data.error).toMatch(/JPEG, PNG, WebP, or GIF/);

		// a refused refund must not leave its proof photo behind
		const before = filesIn(uploadsDir).length;
		expect((await refund({ amountPhp: '999' }, png())).data.error).toMatch(/At most ₱80\.00/);
		expect(filesIn(uploadsDir).length).toBe(before);

		const partial = await refund({ amountPhp: '30', referenceNo: 'GC-777', note: 'First part' }, png());
		expect(partial.ok).toBe('Partial refund recorded.');
		expect(filesIn(uploadsDir).length).toBe(before + 1); // the proof photo was kept
		const [row] = await db.select().from(s.diningPayments).where(eq(s.diningPayments.orderId, order.id));
		expect(row).toMatchObject({ kind: 'refund', amountCentavos: 3_000, method: 'gcash', referenceNo: 'GC-777', provider: 'manual' });
		expect(row!.proofUrl).toMatch(/^\/uploads\/[0-9a-f-]+\/[0-9A-Za-z]+\.png$/);
		expect((await board(manager)).refundDue.find((x: any) => x.id === order.id)).toMatchObject({ refundedCentavos: 3_000 }); // still owed ₱50.00

		expect((await refund({ amountPhp: '50', method: 'paymongo_dashboard' })).ok).toBe('Refund recorded. The order is fully refunded.');
		expect((await board(manager)).refundDue.find((x: any) => x.id === order.id)).toBeUndefined();
	});

	it('counts online orders still waiting for PayMongo, without putting them on the board', async () => {
		const waiting = await o.createDiningOrder({ hotelId: hotelA.id, venueId: venueA, orderType: 'takeaway', source: 'online', guestName: 'Waiting', guestPhone: '09175550000', payMode: 'online', initialStatus: 'pending_payment', lines: [{ menuItemId: soda, quantity: 1 }] });
		const out = await board(asUser(hotelA, CASHIER));
		expect(out.awaitingPayment).toBeGreaterThanOrEqual(1);
		expect(out.orders.map((x: any) => x.id)).not.toContain(waiting.id);
		expect((await board(asUser(hotelB, CASHIER))).awaitingPayment).toBe(0);
	});

	// ---- charge to room ---------------------------------------------------------------------

	/** A guest checked in to a room of `hotel`, with the base stay already paid. */
	async function mkInHouse(hotel: any, name: string, roomNumber: string, status: 'checked_in' | 'confirmed' = 'checked_in') {
		const [rt] = await db.insert(s.roomTypes).values({ hotelId: hotel.id, name: 'Room' }).returning();
		const [rp] = await db.insert(s.ratePlans).values({ hotelId: hotel.id, roomTypeId: rt!.id, name: 'Plan', basePriceCentavos: 100_000 }).returning();
		const [g] = await db.insert(s.guests).values({ hotelId: hotel.id, fullName: name, email: `${tag}@example.test` }).returning();
		const [ord] = await db.insert(s.orders).values({ hotelId: hotel.id, guestId: g!.id, status: 'confirmed', subtotalCentavos: 100_000, feesCentavos: 0, vatCentavos: 0, totalCentavos: 100_000, accessToken: crypto.randomUUID() }).returning();
		const [bk] = await db.insert(s.bookings).values({ hotelId: hotel.id, orderId: ord!.id, checkIn: '2020-01-01', checkOut: '2099-01-01', occupancy: 2, status, subtotalCentavos: 100_000, feesCentavos: 0, vatCentavos: 0, totalCentavos: 100_000 }).returning();
		const [br] = await db.insert(s.bookingRooms).values({ bookingId: bk!.id, roomTypeId: rt!.id, ratePlanId: rp!.id, quantity: 1 } as never).returning();
		const [room] = await db.insert(s.rooms).values({ hotelId: hotel.id, roomTypeId: rt!.id, roomNumber }).returning();
		await db.insert(s.roomAssignments).values({ bookingRoomId: br!.id, roomId: room!.id, checkIn: '2020-01-01', checkOut: '2099-01-01' } as never);
		await db.insert(s.payments).values({ orderId: ord!.id, provider: 'cash', method: 'cash', purpose: 'settlement', status: 'paid', amountCentavos: 100_000, paidAt: new Date() });
		return bk!.id;
	}

	it('lists the guests staying now for staff who take orders, and only for them', async () => {
		const here = await mkInHouse(hotelA, 'Room Charge Rita', 'RC-1');
		await mkInHouse(hotelA, 'Not Yet Nina', 'RC-2', 'confirmed');
		await mkInHouse(hotelB, 'Other Hotel Olga', 'RC-9');
		const cashier = await board(asUser(hotelA, CASHIER));
		expect(cashier.inHouse.map((g: any) => [g.guestName, g.roomNumber])).toEqual([['Room Charge Rita', 'RC-1']]);
		expect(cashier.inHouse[0].bookingId).toBe(here);
		expect((await board(asUser(hotelA, VIEWER))).inHouse).toEqual([]); // a read-only role cannot charge, so is not shown the list
		expect((await board(asUser(hotelB, CASHIER))).inHouse.map((g: any) => g.guestName)).toEqual(['Other Hotel Olga']);
	});

	it('charges an order to a room for staff who take orders, and shows it on the board with the room', async () => {
		const cashier = asUser(hotelA, CASHIER);
		const bookingId = await mkInHouse(hotelA, 'Charge Chad', 'RC-3');
		const order = await o.createDiningOrder({ hotelId: hotelA.id, venueId: venueA, orderType: 'dine_in', lines: [{ menuItemId: soda, quantity: 2 }] });

		expect((await actWith('chargeRoom', asUser(hotelA, VIEWER), { orderId: order.id, bookingId }).catch((e) => e)).status).toBe(403);
		expect((await actWith('chargeRoom', cashier, { orderId: order.id })).status).toBe(400); // no guest chosen
		expect((await actWith('chargeRoom', cashier, { orderId: order.id, bookingId: crypto.randomUUID() })).data.error).toMatch(/not checked in/);

		const out = await actWith('chargeRoom', cashier, { orderId: order.id, bookingId });
		expect(out.charged).toEqual({ orderId: order.id, roomLabel: 'RC-3', guestName: 'Charge Chad' });
		const card = (await board(cashier)).orders.find((x: any) => x.id === order.id);
		expect(card).toMatchObject({ paymentStatus: 'room_charged', roomLabel: 'RC-3', guestName: 'Charge Chad', totalCentavos: 16_000 });
		expect(card.bookingCode).toMatch(/^[0-9A-F]{8}$/);
		expect((await actWith('chargeRoom', cashier, { orderId: order.id, bookingId })).data.error).toMatch(/already charged to a room/);
		// the other hotel's staff cannot charge this hotel's order
		expect((await actWith('chargeRoom', asUser(hotelB, CASHIER), { orderId: order.id, bookingId })).status).toBe(400);
	});

	it('lets only a manager take an order off a room bill', async () => {
		const cashier = asUser(hotelA, CASHIER);
		const manager = asUser(hotelA, MANAGER);
		const bookingId = await mkInHouse(hotelA, 'Undo Una', 'RC-4');
		const order = await o.createDiningOrder({ hotelId: hotelA.id, venueId: venueA, orderType: 'dine_in', lines: [{ menuItemId: soda, quantity: 1 }] });
		await actWith('chargeRoom', cashier, { orderId: order.id, bookingId });

		expect((await actWith('undoRoomCharge', cashier, { orderId: order.id, reason: 'x' }).catch((e) => e)).status).toBe(403);
		expect((await actWith('undoRoomCharge', manager, { orderId: order.id, reason: ' ' })).status).toBe(400);
		expect((await actWith('undoRoomCharge', manager, { orderId: order.id, reason: 'Wrong room' })).ok).toMatch(/unpaid again/);
		expect((await board(manager)).orders.find((x: any) => x.id === order.id)).toMatchObject({ paymentStatus: 'unpaid', roomLabel: null });
		expect((await actWith('undoRoomCharge', manager, { orderId: order.id, reason: 'again' })).data.error).toMatch(/not charged to a room/);
	});
});
