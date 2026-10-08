import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';

/**
 * Live-DB tests for online dining orders: placing, PayMongo checkout and webhook confirmation,
 * expiry, the guest's own view and cancellation requests, messages, and manual refunds. PayMongo
 * is faked (no network) and so is the mailer (nothing is sent). Own throwaway hotels, removed
 * afterwards; skipped when no DATABASE_URL is configured.
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

const mocks = vi.hoisted(() => {
	let n = 0;
	const client = {
		createCheckoutSession: vi.fn(async (_attrs: unknown) => {
			n++;
			return { id: `cs_test_${n}`, attributes: { checkout_url: `https://pay.test/checkout/${n}` } };
		}),
		expireCheckoutSession: vi.fn(async (_id: string) => ({}))
	};
	return { client, state: { payOnline: true }, emails: [] as { orderId: string; kind: string }[] };
});

vi.mock('./paymongo/client', async (orig) => ({
	...(await orig<typeof import('./paymongo/client')>()),
	getPaymongoClient: vi.fn(async () => mocks.client),
	isOnlinePaymentEnabled: vi.fn(async () => mocks.state.payOnline)
}));
vi.mock('./email/send-dining-order', () => ({
	sendDiningOrderEmail: vi.fn(async (orderId: string, kind: string) => {
		mocks.emails.push({ orderId, kind });
		return { ok: true };
	})
}));

describe.skipIf(!hasDb)('online dining orders (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const on = await import('./dining-online');
	const o = await import('./dining-orders');
	const rsv = await import('./dining-reservations');
	const { handlePaymongoEvent } = await import('./paymongo/webhook-handler');
	const { seedFinanceDefaults } = await import('./finance/seed-defaults');
	const { openShift } = await import('./finance/shifts');
	const { createDocumentSeries } = await import('./finance/documents');
	const { businessDateFor } = await import('./finance/shared');

	const tag = `onlinetest-${Math.random().toString(36).slice(2, 10)}`;
	const TZ = 'Asia/Manila';
	const hotelIds: string[] = [];
	let hotelA: any;
	let hotelB: any;
	let venueA = '';
	let venueOff = '';
	let adobo = '';
	let soda = '';
	let rice = '';
	let drawerId = '';
	let undepositedId = '';
	let tableId = '';
	const today = businessDateFor(TZ);
	const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

	async function mkHotel(suffix: string) {
		const [h] = await db
			.insert(s.hotels)
			.values({ slug: `${tag}-${suffix}`, name: `Online test ${suffix}`, orgRef: mintRef('org') })
			.returning();
		hotelIds.push(h!.id);
		return h!;
	}

	beforeAll(async () => {
		hotelA = await mkHotel('a');
		hotelB = await mkHotel('b');
		await seedFinanceDefaults(db, hotelA.id);
		await seedFinanceDefaults(db, hotelB.id);
		await createDocumentSeries(hotelA.id, { type: 'official_receipt', prefix: 'OR', serialFrom: 1, serialTo: 200, atpOrPermitNo: null, dateRegistered: null, accreditedPrinter: null, accreditationNo: null, notes: null }, null);

		const [va] = await db
			.insert(s.diningItems)
			.values({
				hotelId: hotelA.id,
				title: 'Cafe',
				onlineOrdersEnabled: true,
				onlinePayment: 'online_only',
				orderOpen: '00:00',
				orderClose: '23:45',
				prepMinutes: 20,
				reservationsEnabled: true,
				seatingOpen: '11:00',
				lastSeating: '13:00',
				minNoticeMinutes: 0,
				advanceDays: 90
			})
			.returning();
		venueA = va!.id;
		const [vo] = await db.insert(s.diningItems).values({ hotelId: hotelA.id, title: 'Closed cafe', onlineOrdersEnabled: false }).returning();
		venueOff = vo!.id;
		const [tbl] = await db.insert(s.diningTables).values({ hotelId: hotelA.id, diningItemId: venueA, name: 'T1', seats: 4 }).returning();
		tableId = tbl!.id;

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

		const settings = await db.select().from(s.financeSettings).where(eq(s.financeSettings.hotelId, hotelA.id));
		drawerId = settings[0]!.defaultDrawerAccountId!;
		undepositedId = settings[0]!.undepositedAccountId!;
	});

	afterAll(async () => {
		if (hotelIds.length) await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
	});

	beforeEach(() => {
		mocks.state.payOnline = true;
		mocks.emails.length = 0;
		mocks.client.createCheckoutSession.mockClear();
		mocks.client.expireCheckoutSession.mockClear();
	});

	const setVenue = (patch: Partial<typeof s.diningItems.$inferInsert>) =>
		db.update(s.diningItems).set(patch).where(eq(s.diningItems.id, venueA));

	/** An order placed online by a unique guest, so the per-phone brake never interferes. */
	let phoneSeq = 0;
	const place = (over: Record<string, unknown> = {}) =>
		on.placeOnlineOrder({
			hotelId: hotelA.id,
			venueId: venueA,
			timezone: TZ,
			orderType: 'takeaway',
			date: day(1),
			time: '12:00',
			guestName: 'Online Guest',
			guestPhone: `0917${String(1000000 + ++phoneSeq)}`,
			guestEmail: 'guest@example.test',
			payMode: 'online',
			lines: [{ menuItemId: adobo, quantity: 1, addonIds: [rice] }],
			...over
		} as never);

	const paidEvent = (orderId: string, o: { eventId: string; session?: string; amount: number }) => ({
		data: {
			id: o.eventId,
			attributes: {
				type: 'checkout_session.payment.paid',
				data: {
					id: o.session ?? 'cs_x',
					attributes: {
						metadata: { kind: 'dining', diningOrderId: orderId },
						payments: [{ id: `pay_${o.eventId}`, attributes: { amount: o.amount, currency: 'PHP' } }]
					}
				}
			}
		}
	});
	const orderRow = async (id: string) => (await db.select().from(s.diningOrders).where(eq(s.diningOrders.id, id)))[0]!;
	const movements = (orderId: string, hotelId = hotelA.id) =>
		db.select().from(s.cashMovements).where(and(eq(s.cashMovements.hotelId, hotelId), eq(s.cashMovements.sourceType, 'dining_payment')));

	// ---- settings and placing ----------------------------------------------------------

	it('is only on when the venue is switched on, has hours, and guests have a way to pay', async () => {
		expect((await on.loadOnlineOrderingConfig(hotelA.id, venueA))!.enabled).toBe(true);
		expect((await on.loadOnlineOrderingConfig(hotelA.id, venueOff))!.enabled).toBe(false);
		mocks.state.payOnline = false; // PayMongo not connected, venue is online-only → nothing to pay with
		expect((await on.loadOnlineOrderingConfig(hotelA.id, venueA))!.enabled).toBe(false);
		await setVenue({ onlinePayment: 'online_or_venue' }); // pay at the restaurant is enough
		expect((await on.loadOnlineOrderingConfig(hotelA.id, venueA))!.enabled).toBe(true);
		await setVenue({ onlinePayment: 'online_only', orderOpen: null });
		expect((await on.loadOnlineOrderingConfig(hotelA.id, venueA))!.enabled).toBe(false);
		await setVenue({ orderOpen: '00:00' });
		expect(await on.loadOnlineOrderingConfig(hotelB.id, venueA)).toBeNull(); // another hotel's venue
	});

	it('offers pickup times every 15 minutes, no sooner than the prep time', () => {
		const cfg = { orderOpen: '10:00', orderClose: '11:00', prepMinutes: 30 };
		const now = new Date('2026-10-10T02:10:00Z'); // 10:10 in Manila
		const slots = on.pickupSlots(cfg, '2026-10-10', TZ, now).map((x) => x.time);
		expect(slots).toEqual(['10:45', '11:00']); // earliest is 10:40 (now + 30 min prep), so the first 15-minute slot is 10:45
		expect(on.pickupSlots(cfg, '2026-10-11', TZ, now).map((x) => x.time)).toEqual(['10:00', '10:15', '10:30', '10:45', '11:00']);
		expect(on.pickupSlots({ orderOpen: null, orderClose: null, prepMinutes: 20 }, '2026-10-11', TZ, now)).toEqual([]);
	});

	it('holds an order paid online as pending_payment, out of the kitchen until PayMongo confirms', async () => {
		const placed = await place();
		expect(placed.status).toBe('pending_payment');
		const row = await orderRow(placed.id);
		expect(row).toMatchObject({ source: 'online', payMode: 'online', orderType: 'takeaway', paymentStatus: 'unpaid', totalCentavos: 25_000 });
		expect(row.pickupAt).toBeInstanceOf(Date);
		const board = await o.listBoardOrders(hotelA.id, { servedSince: new Date(0) });
		expect(board.map((x) => x.id)).not.toContain(placed.id);
		expect(mocks.emails).toEqual([]); // nothing is confirmed to the guest yet
	});

	it('sends a pay-at-the-restaurant order straight to the kitchen, only where the venue allows it', async () => {
		await expect(place({ payMode: 'venue' })).rejects.toThrow(/online payment only/);
		await setVenue({ onlinePayment: 'online_or_venue' });
		const placed = await place({ payMode: 'venue' });
		expect(placed.status).toBe('new');
		expect((await o.listBoardOrders(hotelA.id, { servedSince: new Date(0) })).map((x) => x.id)).toContain(placed.id);
		expect(mocks.emails).toEqual([{ orderId: placed.id, kind: 'confirmation' }]);
		mocks.state.payOnline = false;
		await expect(place({ payMode: 'online' })).rejects.toThrow(/Online payment is not available/);
		await setVenue({ onlinePayment: 'online_only' });
	});

	it('refuses bad online orders: closed venue, bad pickup time, missing details, bad dishes', async () => {
		await expect(place({ venueId: venueOff })).rejects.toThrow(/not available/);
		await expect(place({ time: '12:07' })).rejects.toThrow(/no longer available/); // not on the 15-minute grid
		await expect(place({ date: day(30) })).rejects.toThrow(/no longer available/); // beyond the 7-day window
		await expect(place({ date: undefined, time: undefined })).rejects.toThrow(/pickup time/);
		await expect(place({ guestName: '  ' })).rejects.toThrow(/name/);
		await expect(place({ guestPhone: '123' })).rejects.toThrow(/mobile number/);
		await expect(place({ lines: [{ menuItemId: adobo, quantity: 1 }] })).rejects.toThrow(/choose an option for "Sides"/);
		await expect(place({ lines: [] })).rejects.toThrow(/at least one item/);
	});

	it('stops one phone number piling up unpaid orders', async () => {
		const phone = '09179990000';
		for (let i = 0; i < 3; i++) await place({ guestPhone: phone });
		await expect(place({ guestPhone: phone })).rejects.toThrow(/several open orders/);
	});

	it("pre-orders onto the guest's own reservation, served at the table time", async () => {
		const res = await rsv.createReservation({ hotelId: hotelA.id, venueId: venueA, timezone: TZ, date: day(5), time: '12:00', partySize: 2, guestName: 'Pre Orderer', source: 'staff' });
		const placed = await place({ orderType: 'pre_order', date: undefined, time: undefined, reservation: { code: res.code, token: res.accessToken } });
		const row = await orderRow(placed.id);
		expect(row.orderType).toBe('pre_order');
		expect(row.reservationId).toBe(res.id);
		expect(row.pickupAt!.getTime()).toBe(res.startsAt.getTime());

		await expect(place({ orderType: 'pre_order', date: undefined, time: undefined, reservation: { code: res.code, token: crypto.randomUUID() } })).rejects.toThrow(/could not find that reservation/);
		await expect(place({ orderType: 'pre_order', date: undefined, time: undefined })).rejects.toThrow(/reservation ticket/);
		await rsv.setReservationStatus({ hotelId: hotelA.id, reservationId: res.id, to: 'cancelled' });
		await expect(place({ orderType: 'pre_order', date: undefined, time: undefined, reservation: { code: res.code, token: res.accessToken } })).rejects.toThrow(/no longer active/);
		void tableId;
	});

	// ---- checkout ----------------------------------------------------------------------

	it('starts a PayMongo checkout for exactly the order total, tagged as dining', async () => {
		const placed = await place({ lines: [{ menuItemId: adobo, quantity: 2, addonIds: [rice] }, { menuItemId: soda, quantity: 1 }] });
		const { checkoutUrl } = await on.startDiningCheckout({ hotelId: hotelA.id, orderId: placed.id, hotelName: 'Online test', successUrl: 'https://x/ok', cancelUrl: 'https://x/no' });
		expect(checkoutUrl).toMatch(/^https:\/\/pay\.test\/checkout\//);
		const attrs = mocks.client.createCheckoutSession.mock.calls[0]![0] as any;
		expect(attrs.metadata).toEqual({ kind: 'dining', diningOrderId: placed.id });
		expect(attrs.line_items.reduce((sum: number, l: any) => sum + l.amount * l.quantity, 0)).toBe(58_000); // 2×250 + 80
		expect(attrs.success_url).toBe('https://x/ok');
		const pending = await db.select().from(s.diningPayments).where(eq(s.diningPayments.orderId, placed.id));
		expect(pending).toMatchObject([{ kind: 'payment', status: 'pending', provider: 'paymongo', amountCentavos: 58_000 }]);

		// trying again expires the earlier link, so only the newest can be paid
		await on.startDiningCheckout({ hotelId: hotelA.id, orderId: placed.id, hotelName: 'Online test', successUrl: 'https://x/ok', cancelUrl: 'https://x/no' });
		expect(mocks.client.expireCheckoutSession).toHaveBeenCalledWith(pending[0]!.paymongoCheckoutSessionId);
		const all = await db.select().from(s.diningPayments).where(eq(s.diningPayments.orderId, placed.id));
		expect(all.map((p) => p.status).sort()).toEqual(['expired', 'pending']);
	});

	it('will not start checkout for an order that is not waiting for online payment', async () => {
		await setVenue({ onlinePayment: 'online_or_venue' });
		const venuePay = await place({ payMode: 'venue' });
		await expect(on.startDiningCheckout({ hotelId: hotelA.id, orderId: venuePay.id, hotelName: 'x', successUrl: 'a', cancelUrl: 'b' })).rejects.toThrow(/not waiting for online payment/);
		await setVenue({ onlinePayment: 'online_only' });
		await expect(on.startDiningCheckout({ hotelId: hotelB.id, orderId: venuePay.id, hotelName: 'x', successUrl: 'a', cancelUrl: 'b' })).rejects.toThrow(/could not be found/);
	});

	// ---- the webhook -------------------------------------------------------------------

	it('confirms a payment from the webhook: releases the order, posts dining revenue, issues the receipt, emails the guest', async () => {
		const placed = await place();
		await on.startDiningCheckout({ hotelId: hotelA.id, orderId: placed.id, hotelName: 'x', successUrl: 'a', cancelUrl: 'b' });
		const [pending] = await db.select().from(s.diningPayments).where(eq(s.diningPayments.orderId, placed.id));

		await handlePaymongoEvent(paidEvent(placed.id, { eventId: 'evt_1', session: pending!.paymongoCheckoutSessionId!, amount: 25_000 }), { hotelId: hotelA.id });

		const row = await orderRow(placed.id);
		expect(row).toMatchObject({ status: 'new', paymentStatus: 'paid', paymentMethod: 'paymongo', businessDate: today, cashAccountId: undepositedId });
		const [mv] = await movements(placed.id);
		expect(mv).toMatchObject({ category: 'dining_revenue', direction: 'in', amountCentavos: 25_000, cashAccountId: undepositedId, sourceId: pending!.id });
		expect(row.cashMovementId).toBe(mv!.id);

		const [payRow] = await db.select().from(s.diningPayments).where(eq(s.diningPayments.id, pending!.id));
		expect(payRow).toMatchObject({ status: 'paid', paymongoEventId: 'evt_1', paymongoPaymentId: 'pay_evt_1', cashMovementId: mv!.id });
		expect((await o.getOrderDocuments(hotelA.id, placed.id))[0]).toMatchObject({ type: 'official_receipt' });
		expect((await o.listBoardOrders(hotelA.id, { servedSince: new Date(0) })).map((x) => x.id)).toContain(placed.id); // now in the kitchen
		expect(mocks.emails).toContainEqual({ orderId: placed.id, kind: 'confirmation' });
	});

	it('records a redelivered event once: no second movement, receipt or email', async () => {
		const placed = await place();
		await on.startDiningCheckout({ hotelId: hotelA.id, orderId: placed.id, hotelName: 'x', successUrl: 'a', cancelUrl: 'b' });
		const evt = paidEvent(placed.id, { eventId: 'evt_redeliver', amount: 25_000 });
		await handlePaymongoEvent(evt, { hotelId: hotelA.id });
		await handlePaymongoEvent(evt, { hotelId: hotelA.id });
		await handlePaymongoEvent(evt, { hotelId: hotelA.id });
		const mine = (await movements(placed.id)).filter((m) => m.memo?.includes(placed.code));
		expect(mine).toHaveLength(1);
		expect(await o.getOrderDocuments(hotelA.id, placed.id)).toHaveLength(1);
		expect(mocks.emails.filter((e) => e.orderId === placed.id)).toHaveLength(1);
	});

	it("ignores a payment event that belongs to another hotel's endpoint", async () => {
		const placed = await place();
		await handlePaymongoEvent(paidEvent(placed.id, { eventId: 'evt_wrong_hotel', amount: 25_000 }), { hotelId: hotelB.id });
		expect((await orderRow(placed.id)).status).toBe('pending_payment');
		expect(await db.select().from(s.diningPayments).where(eq(s.diningPayments.paymongoEventId, 'evt_wrong_hotel'))).toEqual([]);
	});

	it('records a declined attempt without touching the order', async () => {
		const placed = await place();
		await handlePaymongoEvent(
			{ data: { id: 'evt_fail', attributes: { type: 'checkout_session.payment.failed', data: { id: 'cs_f', attributes: { metadata: { kind: 'dining', diningOrderId: placed.id }, payments: [{ id: 'pay_f', attributes: { amount: 25_000, currency: 'PHP' } }] } } } } },
			{ hotelId: hotelA.id }
		);
		expect((await orderRow(placed.id)).status).toBe('pending_payment');
		const [p] = await db.select().from(s.diningPayments).where(eq(s.diningPayments.orderId, placed.id));
		expect(p).toMatchObject({ status: 'failed', paymongoEventId: 'evt_fail' });
	});

	it('keeps the money and flags a refund when payment lands on an order that was already released', async () => {
		const placed = await place();
		await on.expirePendingDiningOrders({ hotelId: hotelA.id, olderThanMinutes: -1 }); // everything pending is released now
		expect((await orderRow(placed.id)).status).toBe('cancelled');

		const out = await on.confirmDiningPayment({ eventId: 'evt_late', orderId: placed.id, sessionId: 'cs_late', paymentId: 'pay_late', amountCentavos: 25_000, payload: {} });
		expect(out).toMatchObject({ handled: true, confirmed: false, needsRefund: true });
		const row = await orderRow(placed.id);
		expect(row).toMatchObject({ status: 'cancelled', paymentStatus: 'paid' }); // stays cancelled, paid → refund due
		expect((await movements(placed.id)).some((m) => m.amountCentavos === 25_000)).toBe(true);
		expect(mocks.emails.filter((e) => e.orderId === placed.id)).toEqual([]); // no confirmation for a released order
	});

	it('flags a second payment on an order that is already paid', async () => {
		const placed = await place();
		await handlePaymongoEvent(paidEvent(placed.id, { eventId: 'evt_first', amount: 25_000 }), { hotelId: hotelA.id });
		const second = await on.confirmDiningPayment({ eventId: 'evt_second', orderId: placed.id, sessionId: 'cs_2', paymentId: 'pay_2', amountCentavos: 25_000, payload: {} });
		expect(second).toMatchObject({ handled: true, confirmed: false, needsRefund: true });
		const rows = await db.select().from(s.diningPayments).where(and(eq(s.diningPayments.orderId, placed.id), eq(s.diningPayments.status, 'paid')));
		expect(rows).toHaveLength(2); // both payments are on record
	});

	// ---- expiry ------------------------------------------------------------------------

	it('releases unpaid online orders after the hold, expires their link, and leaves paid and fresh ones alone', async () => {
		const stale = await place();
		await on.startDiningCheckout({ hotelId: hotelA.id, orderId: stale.id, hotelName: 'x', successUrl: 'a', cancelUrl: 'b' });
		const fresh = await place();
		const paid = await place();
		await handlePaymongoEvent(paidEvent(paid.id, { eventId: 'evt_keep', amount: 25_000 }), { hotelId: hotelA.id });
		await db.update(s.diningOrders).set({ createdAt: new Date(Date.now() - 45 * 60_000) }).where(inArray(s.diningOrders.id, [stale.id, paid.id]));
		mocks.client.expireCheckoutSession.mockClear();

		const n = await on.expirePendingDiningOrders({ hotelId: hotelA.id });
		expect(n).toBeGreaterThanOrEqual(1);
		expect(await orderRow(stale.id)).toMatchObject({ status: 'cancelled' });
		expect((await orderRow(stale.id)).cancelReason).toMatch(/not completed/);
		expect(mocks.client.expireCheckoutSession).toHaveBeenCalled();
		expect((await orderRow(fresh.id)).status).toBe('pending_payment');
		expect((await orderRow(paid.id)).status).toBe('new');
		expect(await on.expirePendingDiningOrders({ hotelId: hotelB.id })).toBe(0); // scoped by hotel
	});

	// ---- the guest's own order ---------------------------------------------------------

	it('shows an order only with the right code and token, in the right hotel', async () => {
		const placed = await place();
		const ok = await on.getOrderForGuest(hotelA.id, TZ, placed.code, placed.accessToken);
		expect(ok).toMatchObject({ code: placed.code, status: 'pending_payment', needsPayment: true, canCancel: true, canRequestCancel: false, venueTitle: 'Cafe', totalCentavos: 25_000 });
		expect(ok!.items[0]).toMatchObject({ name: 'Adobo', quantity: 1 });
		expect(ok!.pickupLocal!.date).toBe(day(1));
		expect(await on.getOrderForGuest(hotelA.id, TZ, placed.code, crypto.randomUUID())).toBeNull();
		expect(await on.getOrderForGuest(hotelA.id, TZ, placed.code, 'nope')).toBeNull();
		expect(await on.getOrderForGuest(hotelB.id, TZ, placed.code, placed.accessToken)).toBeNull();
		expect((await on.getOrderForGuest(hotelA.id, TZ, placed.code.toLowerCase(), placed.accessToken))?.id).toBe(placed.id);
	});

	it('lets a guest cancel an unpaid order themselves, until the kitchen starts, and expires their link', async () => {
		const placed = await place();
		await on.startDiningCheckout({ hotelId: hotelA.id, orderId: placed.id, hotelName: 'x', successUrl: 'a', cancelUrl: 'b' });
		await on.cancelDiningOrderAsGuest(hotelA.id, placed.code, placed.accessToken);
		expect(await orderRow(placed.id)).toMatchObject({ status: 'cancelled', cancelReason: 'Cancelled by the guest.' });
		await expect(on.cancelDiningOrderAsGuest(hotelA.id, placed.code, placed.accessToken)).rejects.toThrow(/already started|paid/);
		await expect(on.cancelDiningOrderAsGuest(hotelB.id, placed.code, placed.accessToken)).rejects.toThrow(/could not find/);

		await setVenue({ onlinePayment: 'online_or_venue' });
		const venuePay = await place({ payMode: 'venue' });
		await o.setDiningOrderStatus({ hotelId: hotelA.id, orderId: venuePay.id, to: 'preparing' });
		await expect(on.cancelDiningOrderAsGuest(hotelA.id, venuePay.code, venuePay.accessToken)).rejects.toThrow(/already started/);
		await setVenue({ onlinePayment: 'online_only' });
	});

	it('asks for cancellation on a paid order, and staff approve or decline it', async () => {
		const a = await place();
		await handlePaymongoEvent(paidEvent(a.id, { eventId: 'evt_cr1', amount: 25_000 }), { hotelId: hotelA.id });
		await expect(on.cancelDiningOrderAsGuest(hotelA.id, a.code, a.accessToken)).rejects.toThrow(/paid/);

		await on.requestDiningCancellation(hotelA.id, a.code, a.accessToken, 'Plans changed');
		expect(await orderRow(a.id)).toMatchObject({ cancelRequestedAt: expect.any(Date), cancelRequestNote: 'Plans changed' });
		await expect(on.requestDiningCancellation(hotelA.id, a.code, a.accessToken, 'again')).rejects.toThrow(/already asked/);
		expect((await on.getOrderForGuest(hotelA.id, TZ, a.code, a.accessToken))).toMatchObject({ cancelRequested: true, canRequestCancel: false });

		await on.respondToDiningCancellation({ hotelId: hotelA.id, orderId: a.id, approve: true, actor: null });
		expect(await orderRow(a.id)).toMatchObject({ status: 'cancelled', paymentStatus: 'paid', cancelRequestedAt: null }); // paid, so a refund is now due
		const msgs = await on.listOrderMessages(hotelA.id, a.id);
		expect(msgs.map((m) => m.direction)).toEqual(['guest', 'staff']);
		expect(msgs[1]!.body).toMatch(/refund/i);

		const b = await place();
		await handlePaymongoEvent(paidEvent(b.id, { eventId: 'evt_cr2', amount: 25_000 }), { hotelId: hotelA.id });
		await on.requestDiningCancellation(hotelA.id, b.code, b.accessToken, '');
		await on.respondToDiningCancellation({ hotelId: hotelA.id, orderId: b.id, approve: false, message: 'Sorry, it is already being cooked.', actor: null });
		expect(await orderRow(b.id)).toMatchObject({ status: 'new', cancelRequestedAt: null });
		await expect(on.respondToDiningCancellation({ hotelId: hotelA.id, orderId: b.id, approve: true, actor: null })).rejects.toThrow(/no cancellation request/);

		// not once the food is ready
		const c = await place();
		await handlePaymongoEvent(paidEvent(c.id, { eventId: 'evt_cr3', amount: 25_000 }), { hotelId: hotelA.id });
		await o.setDiningOrderStatus({ hotelId: hotelA.id, orderId: c.id, to: 'preparing' });
		await o.setDiningOrderStatus({ hotelId: hotelA.id, orderId: c.id, to: 'ready' });
		await expect(on.requestDiningCancellation(hotelA.id, c.code, c.accessToken, 'x')).rejects.toThrow(/already ready or finished/);
	});

	it('emails the guest when an online order is ready, and not for a staff-taken one', async () => {
		const placed = await place();
		await handlePaymongoEvent(paidEvent(placed.id, { eventId: 'evt_ready', amount: 25_000 }), { hotelId: hotelA.id });
		mocks.emails.length = 0;
		await o.setDiningOrderStatus({ hotelId: hotelA.id, orderId: placed.id, to: 'preparing' });
		expect(mocks.emails).toEqual([]);
		await o.setDiningOrderStatus({ hotelId: hotelA.id, orderId: placed.id, to: 'ready' });
		expect(mocks.emails).toEqual([{ orderId: placed.id, kind: 'ready' }]);

		mocks.emails.length = 0;
		const staffOrder = await o.createDiningOrder({ hotelId: hotelA.id, venueId: venueA, orderType: 'dine_in', lines: [{ menuItemId: soda, quantity: 1 }] });
		await o.setDiningOrderStatus({ hotelId: hotelA.id, orderId: staffOrder.id, to: 'preparing' });
		await o.setDiningOrderStatus({ hotelId: hotelA.id, orderId: staffOrder.id, to: 'ready' });
		expect(mocks.emails).toEqual([]);
	});

	// ---- messages ----------------------------------------------------------------------

	it('keeps a short guest and staff thread, with unread tracking and limits', async () => {
		const placed = await place();
		await on.postGuestMessage(hotelA.id, placed.code, placed.accessToken, '  Any chance for extra rice?  ');
		await on.postStaffMessage({ hotelId: hotelA.id, orderId: placed.id, body: 'Of course!', actor: null });
		let msgs = await on.listOrderMessages(hotelA.id, placed.id);
		expect(msgs.map((m) => [m.direction, m.body])).toEqual([['guest', 'Any chance for extra rice?'], ['staff', 'Of course!']]);
		expect(msgs[0]!.readAt).toBeNull();
		await on.markGuestMessagesRead(hotelA.id, placed.id);
		msgs = await on.listOrderMessages(hotelA.id, placed.id);
		expect(msgs[0]!.readAt).not.toBeNull();

		await expect(on.postGuestMessage(hotelA.id, placed.code, placed.accessToken, '   ')).rejects.toThrow(/Type a message/);
		await expect(on.postGuestMessage(hotelA.id, placed.code, placed.accessToken, 'x'.repeat(1001))).rejects.toThrow(/1,000/);
		await expect(on.postGuestMessage(hotelA.id, placed.code, crypto.randomUUID(), 'hi')).rejects.toThrow(/could not find/);
		await expect(on.postGuestMessage(hotelB.id, placed.code, placed.accessToken, 'hi')).rejects.toThrow(/could not find/);
		await expect(on.postStaffMessage({ hotelId: hotelB.id, orderId: placed.id, body: 'hi', actor: null })).rejects.toThrow(/could not be found/);
		for (let i = 0; i < 9; i++) await on.postGuestMessage(hotelA.id, placed.code, placed.accessToken, `m${i}`); // with the first one, that is 10 in the hour
		await expect(on.postGuestMessage(hotelA.id, placed.code, placed.accessToken, 'one too many')).rejects.toThrow(/lot of messages/);
	});

	// ---- manual refund -----------------------------------------------------------------

	it('records a manual refund: posts a cash-out, tells the guest, and stops at what was paid', async () => {
		const placed = await place({ lines: [{ menuItemId: adobo, quantity: 2, addonIds: [rice] }] }); // ₱500.00
		await handlePaymongoEvent(paidEvent(placed.id, { eventId: 'evt_refund', amount: 50_000 }), { hotelId: hotelA.id });
		await on.requestDiningCancellation(hotelA.id, placed.code, placed.accessToken, 'Cannot make it');
		await on.respondToDiningCancellation({ hotelId: hotelA.id, orderId: placed.id, approve: true, actor: null });

		await expect(on.recordDiningRefund({ hotelId: hotelA.id, orderId: placed.id, amountCentavos: 0, method: 'gcash', actor: null })).rejects.toThrow(/refund amount/);
		await expect(on.recordDiningRefund({ hotelId: hotelA.id, orderId: placed.id, amountCentavos: 60_000, method: 'gcash', actor: null })).rejects.toThrow(/At most ₱500\.00/);
		await expect(on.recordDiningRefund({ hotelId: hotelA.id, orderId: placed.id, amountCentavos: 100, method: 'crypto' as never, actor: null })).rejects.toThrow(/how the refund was sent/);
		await expect(on.recordDiningRefund({ hotelId: hotelB.id, orderId: placed.id, amountCentavos: 100, method: 'gcash', actor: null })).rejects.toThrow(/could not be found/);

		const first = await on.recordDiningRefund({ hotelId: hotelA.id, orderId: placed.id, amountCentavos: 20_000, method: 'gcash', referenceNo: 'GC-123', proofUrl: '/uploads/x/proof.jpg', note: 'Partial', actor: null });
		expect(first).toEqual({ refundedCentavos: 20_000, fullyRefunded: false });
		expect((await orderRow(placed.id)).paymentStatus).toBe('paid'); // not fully refunded yet

		const second = await on.recordDiningRefund({ hotelId: hotelA.id, orderId: placed.id, amountCentavos: 30_000, method: 'paymongo_dashboard', referenceNo: 'rf_abc', actor: null });
		expect(second).toEqual({ refundedCentavos: 50_000, fullyRefunded: true });
		expect((await orderRow(placed.id)).paymentStatus).toBe('refunded');
		await expect(on.recordDiningRefund({ hotelId: hotelA.id, orderId: placed.id, amountCentavos: 100, method: 'gcash', actor: null })).rejects.toThrow(/Only a paid order/);

		const refunds = await db.select().from(s.diningPayments).where(and(eq(s.diningPayments.orderId, placed.id), eq(s.diningPayments.kind, 'refund')));
		expect(refunds.map((r) => [r.amountCentavos, r.method, r.referenceNo, r.provider])).toEqual(
			expect.arrayContaining([[20_000, 'gcash', 'GC-123', 'manual'], [30_000, 'paymongo_dashboard', 'rf_abc', 'manual']])
		);
		expect(refunds.find((r) => r.referenceNo === 'GC-123')!.proofUrl).toBe('/uploads/x/proof.jpg');

		const outs = await db.select().from(s.cashMovements).where(and(eq(s.cashMovements.hotelId, hotelA.id), eq(s.cashMovements.sourceType, 'dining_refund')));
		const mine = outs.filter((m) => refunds.some((r) => r.id === m.sourceId));
		expect(mine.map((m) => [m.direction, m.category, m.amountCentavos, m.cashAccountId])).toEqual(
			expect.arrayContaining([['out', 'refund', 20_000, undepositedId], ['out', 'refund', 30_000, undepositedId]])
		);

		const view = await on.getOrderForGuest(hotelA.id, TZ, placed.code, placed.accessToken);
		expect(view!.refund).toMatchObject({ amountCentavos: 30_000, method: 'paymongo_dashboard', referenceNo: 'rf_abc' });
		const thread = (await on.listOrderMessages(hotelA.id, placed.id)).filter((m) => m.direction === 'staff');
		expect(thread.some((m) => m.body.includes('GC-123') && m.body.includes('₱200.00'))).toBe(true);
	});

	it('refunds cash from the drawer only with an open shift, and refuses an unpaid order', async () => {
		const unpaid = await place();
		await expect(on.recordDiningRefund({ hotelId: hotelA.id, orderId: unpaid.id, amountCentavos: 100, method: 'gcash', actor: null })).rejects.toThrow(/Only a paid order/);

		const placed = await place();
		await handlePaymongoEvent(paidEvent(placed.id, { eventId: 'evt_cashref', amount: 25_000 }), { hotelId: hotelA.id });
		await expect(on.recordDiningRefund({ hotelId: hotelA.id, orderId: placed.id, amountCentavos: 25_000, method: 'cash', actor: null })).rejects.toThrow(/Open a cashier shift/);
		expect((await orderRow(placed.id)).paymentStatus).toBe('paid'); // nothing half-recorded

		await openShift({ hotelId: hotelA.id, cashAccountId: drawerId, businessDate: today, openingFloatCentavos: 50_000, actor: null });
		await on.recordDiningRefund({ hotelId: hotelA.id, orderId: placed.id, amountCentavos: 25_000, method: 'cash', actor: null });
		const [refund] = await db.select().from(s.diningPayments).where(and(eq(s.diningPayments.orderId, placed.id), eq(s.diningPayments.kind, 'refund')));
		const [mv] = await db.select().from(s.cashMovements).where(eq(s.cashMovements.sourceId, refund!.id));
		expect(mv).toMatchObject({ direction: 'out', category: 'refund', cashAccountId: drawerId });
		expect(mv!.shiftId).toBeTruthy();
	});
});
