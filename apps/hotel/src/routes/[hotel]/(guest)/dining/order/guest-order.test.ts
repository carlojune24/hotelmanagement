import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

/**
 * Live-DB tests for the guest's online ordering page and order tracking page (server side):
 * what the page loads, placing an order and where the guest is sent next, and every action on
 * their own order. PayMongo and the mailer are faked. Own throwaway hotels; skipped without a database.
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
		createCheckoutSession: vi.fn(async (_a: unknown) => {
			n++;
			return { id: `cs_guest_${n}`, attributes: { checkout_url: `https://pay.test/checkout/${n}` } };
		}),
		expireCheckoutSession: vi.fn(async (_id: string) => ({}))
	};
	return { client, state: { payOnline: true, failCheckout: false }, emails: [] as string[] };
});

vi.mock('$lib/server/paymongo/client', async (orig) => ({
	...(await orig<typeof import('$lib/server/paymongo/client')>()),
	getPaymongoClient: vi.fn(async () => {
		if (mocks.state.failCheckout) throw new Error('PayMongo is down');
		return mocks.client;
	}),
	isOnlinePaymentEnabled: vi.fn(async () => mocks.state.payOnline)
}));
vi.mock('$lib/server/email/send-dining-order', () => ({
	sendDiningOrderEmail: vi.fn(async (orderId: string, kind: string) => {
		mocks.emails.push(`${kind}:${orderId}`);
		return { ok: true };
	})
}));

describe.skipIf(!hasDb)('guest dining order pages (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const orderPage = await import('./+page.server');
	const trackPage = await import('./[code]/+page.server');
	const on = await import('$lib/server/dining-online');
	const rsv = await import('$lib/server/dining-reservations');
	const { handlePaymongoEvent } = await import('$lib/server/paymongo/webhook-handler');
	const { seedFinanceDefaults } = await import('$lib/server/finance/seed-defaults');

	const tag = `guestorder-${Math.random().toString(36).slice(2, 10)}`;
	const TZ = 'Asia/Manila';
	const hotelIds: string[] = [];
	let hotelA: any;
	let hotelB: any;
	let venue = '';
	let venue2 = '';
	let adobo = '';
	let soda = '';
	let rice = '';
	const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

	async function mkHotel(suffix: string) {
		const [h] = await db.insert(s.hotels).values({ slug: `${tag}-${suffix}`, name: `Guest order ${suffix}`, orgRef: mintRef('org') }).returning();
		hotelIds.push(h!.id);
		return h!;
	}
	const as = (hotel: any) => ({ hotel }) as never;
	const setVenue = (id: string, patch: Partial<typeof s.diningItems.$inferInsert>) => db.update(s.diningItems).set(patch).where(eq(s.diningItems.id, id));

	const loadOrder = (hotel: any, qs = '') => orderPage.load({ locals: as(hotel), url: new URL(`http://x/order${qs}`) } as never) as Promise<any>;
	const placeEvent = (hotel: any, payload: unknown) =>
		({ locals: as(hotel), params: { hotel: hotel.slug }, url: new URL('http://shop.test/order'), request: { formData: async () => { const f = new FormData(); f.set('payload', typeof payload === 'string' ? payload : JSON.stringify(payload)); return f; } } }) as never;
	/** Runs an action and returns either its value or the redirect it threw. */
	async function run(fn: () => Promise<any>): Promise<any> {
		try {
			return await fn();
		} catch (e: any) {
			if (e && typeof e === 'object' && 'location' in e) return { redirect: e.location as string, status: e.status as number };
			throw e;
		}
	}

	const body = (over: Record<string, unknown> = {}) => ({
		venueId: venue,
		orderType: 'takeaway',
		date: day(1),
		time: '12:00',
		guestName: 'Gina Guest',
		guestPhone: '09171234567',
		guestEmail: 'gina@example.test',
		payMode: 'online',
		lines: [{ menuItemId: adobo, quantity: 1, addonIds: [rice] }],
		...over
	});

	beforeAll(async () => {
		hotelA = await mkHotel('a');
		hotelB = await mkHotel('b');
		await seedFinanceDefaults(db, hotelA.id);
		const [v] = await db
			.insert(s.diningItems)
			.values({ hotelId: hotelA.id, title: 'Cafe', onlineOrdersEnabled: true, onlinePayment: 'online_or_venue', orderOpen: '00:00', orderClose: '23:45', prepMinutes: 20, pickupNote: 'Collect at the counter', reservationsEnabled: true, seatingOpen: '11:00', lastSeating: '13:00', minNoticeMinutes: 0, advanceDays: 60 })
			.returning();
		venue = v!.id;
		const [v2] = await db.insert(s.diningItems).values({ hotelId: hotelA.id, title: 'Bar', onlineOrdersEnabled: true, onlinePayment: 'online_only', orderOpen: '00:00', orderClose: '23:45' }).returning();
		venue2 = v2!.id;
		await db.insert(s.diningTables).values({ hotelId: hotelA.id, diningItemId: venue, name: 'T1', seats: 4 });
		const [st] = await db.insert(s.diningStations).values({ hotelId: hotelA.id, name: 'Kitchen' }).returning();
		const items = await db
			.insert(s.diningMenuItems)
			.values([
				{ hotelId: hotelA.id, diningItemId: venue, name: 'Adobo', priceCentavos: 25_000, stationId: st!.id },
				{ hotelId: hotelA.id, diningItemId: venue, name: 'Soda', priceCentavos: 8_000, taxable: false },
				{ hotelId: hotelA.id, diningItemId: venue, name: 'Hidden', priceCentavos: 1_000, isActive: false }
			])
			.returning();
		[adobo, soda] = [items[0]!.id, items[1]!.id];
		const [g] = await db.insert(s.diningAddonGroups).values({ hotelId: hotelA.id, diningItemId: venue, name: 'Sides', minChoices: 1, maxChoices: 1 }).returning();
		const [r] = await db.insert(s.diningAddons).values({ hotelId: hotelA.id, groupId: g!.id, name: 'Rice', priceCentavos: 0 }).returning();
		rice = r!.id;
		await db.insert(s.diningMenuItemAddonGroups).values({ menuItemId: adobo, addonGroupId: g!.id });
		await db.insert(s.diningMenuItems).values({ hotelId: hotelA.id, diningItemId: venue2, name: 'Beer', priceCentavos: 12_000 });
	});

	afterAll(async () => {
		if (hotelIds.length) await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
	});

	beforeEach(() => {
		mocks.state.payOnline = true;
		mocks.state.failCheckout = false;
		mocks.emails.length = 0;
		mocks.client.createCheckoutSession.mockClear();
		mocks.client.expireCheckoutSession.mockClear();
	});

	// ---- the ordering page ---------------------------------------------------------------

	it('is not there for a hotel with no venue taking online orders', async () => {
		await expect(loadOrder(hotelB)).rejects.toMatchObject({ status: 404 });
		await setVenue(venue2, { onlineOrdersEnabled: false });
		await setVenue(venue, { onlineOrdersEnabled: false });
		await expect(loadOrder(hotelA)).rejects.toMatchObject({ status: 404 });
		await setVenue(venue, { onlineOrdersEnabled: true });
		await setVenue(venue2, { onlineOrdersEnabled: true });
	});

	it('loads the menu a guest may order from, without staff-only fields or hidden dishes', async () => {
		const out = await loadOrder(hotelA, `?venue=${venue}`);
		expect(out.venue).toMatchObject({ id: venue, title: 'Cafe' });
		expect(out.cfg).toMatchObject({ orderOpen: '00:00', orderClose: '23:45', prepMinutes: 20, pickupNote: 'Collect at the counter', canPayOnline: true, canPayAtVenue: true });
		expect(out.menu.items.map((i: any) => i.name).sort()).toEqual(['Adobo', 'Soda']); // the hidden dish is not offered
		expect(Object.keys(out.menu.items[0]).sort()).toEqual(['addonGroupIds', 'categoryId', 'description', 'id', 'imageUrl', 'isAvailable', 'name', 'priceCentavos']); // no station, tax flag or sort data
		expect(out.menu.groups[0]).toMatchObject({ name: 'Sides', minChoices: 1, maxChoices: 1 });
		expect(out.reservation).toBeNull();
		expect(out.venues.map((v: any) => v.title).sort()).toEqual(['Bar', 'Cafe']);
		expect((await loadOrder(hotelA, `?venue=${venue2}`)).venue.title).toBe('Bar');
		expect((await loadOrder(hotelA, '?venue=not-a-venue')).venue.id).toBeTruthy(); // falls back to the first
	});

	it('leaves out a venue that cannot take orders: online-only with no PayMongo', async () => {
		mocks.state.payOnline = false;
		const out = await loadOrder(hotelA);
		expect(out.venues.map((v: any) => v.title)).toEqual(['Cafe']); // Bar is online-only, so it cannot be ordered from
	});

	it('ties a pre-order to the guest\'s own reservation, and ignores a bad ticket', async () => {
		const res = await rsv.createReservation({ hotelId: hotelA.id, venueId: venue, timezone: TZ, date: day(5), time: '12:00', partySize: 2, guestName: 'Pre', source: 'staff' });
		const ok = await loadOrder(hotelA, `?reservation=${res.code}&t=${res.accessToken}`);
		expect(ok.reservation).toMatchObject({ code: res.code, token: res.accessToken, venueTitle: 'Cafe', local: { date: day(5), time: '12:00' } });
		expect((await loadOrder(hotelA, `?reservation=${res.code}&t=${crypto.randomUUID()}`)).reservation).toBeNull();
		expect((await loadOrder(hotelA, `?reservation=${res.code}`)).reservation).toBeNull();
		await rsv.setReservationStatus({ hotelId: hotelA.id, reservationId: res.id, to: 'cancelled' });
		expect((await loadOrder(hotelA, `?reservation=${res.code}&t=${res.accessToken}`)).reservation).toBeNull();
	});

	// ---- placing an order ----------------------------------------------------------------

	it('refuses an order it cannot read, or that is empty, or a bot filled in', async () => {
		const place = (payload: unknown) => run(() => orderPage.actions.place!(placeEvent(hotelA, payload)) as any);
		expect((await place('{not json')).status).toBe(400);
		expect((await place(body({ lines: [] }))).data.error).toMatch(/at least one item/i);
		expect((await place(body({ guestName: ' ' }))).data.error).toMatch(/your name/i);
		expect((await place(body({ guestPhone: '1' }))).data.error).toMatch(/mobile number/i);
		expect((await place(body({ guestEmail: 'nope' }))).data.error).toMatch(/email/i);
		expect((await place(body({ orderType: 'delivery' }))).status).toBe(400);
		expect((await place(body({ website: 'http://spam' }))).data.error).toMatch(/went wrong/);
		expect(await db.select().from(s.diningOrders).where(eq(s.diningOrders.guestName, ' '))).toEqual([]);
	});

	it('explains a business refusal: a required choice missing, a time that is gone', async () => {
		const place = (payload: unknown) => run(() => orderPage.actions.place!(placeEvent(hotelA, payload)) as any);
		const noSide = await place(body({ lines: [{ menuItemId: adobo, quantity: 1 }] }));
		expect(noSide).toMatchObject({ status: 409 });
		expect(noSide.data.error).toMatch(/choose an option for "Sides"/);
		expect((await place(body({ time: '12:07' }))).data.error).toMatch(/no longer available/);
	});

	it('sends a guest paying online to PayMongo, with the order held until it is paid', async () => {
		const res = await run(() => orderPage.actions.place!(placeEvent(hotelA, body())) as any);
		expect(res.status).toBe(303);
		expect(res.redirect).toMatch(/^https:\/\/pay\.test\/checkout\//);
		const attrs = mocks.client.createCheckoutSession.mock.calls[0]![0] as any;
		expect(attrs.metadata).toMatchObject({ kind: 'dining' });
		expect(attrs.success_url).toMatch(new RegExp(`^http://shop\\.test/${hotelA.slug}/dining/order/DN-[A-Z0-9]{4}\\?t=[0-9a-f-]{36}&paid=1$`));
		expect(attrs.cancel_url).toMatch(/&cancelled=1$/);
		const [row] = await db.select().from(s.diningOrders).where(eq(s.diningOrders.id, attrs.metadata.diningOrderId));
		expect(row).toMatchObject({ status: 'pending_payment', payMode: 'online', source: 'online', totalCentavos: 25_000 });
	});

	it('sends a guest paying at the restaurant straight to their order page, already in the kitchen', async () => {
		const res = await run(() => orderPage.actions.place!(placeEvent(hotelA, body({ payMode: 'venue' }))) as any);
		expect(res.status).toBe(303);
		expect(res.redirect).toMatch(new RegExp(`^/${hotelA.slug}/dining/order/DN-[A-Z0-9]{4}\\?t=[0-9a-f-]{36}$`));
		expect(mocks.client.createCheckoutSession).not.toHaveBeenCalled();
		const code = res.redirect.match(/DN-[A-Z0-9]{4}/)![0];
		const [row] = await db.select().from(s.diningOrders).where(eq(s.diningOrders.code, code));
		expect(row).toMatchObject({ status: 'new', payMode: 'venue', paymentStatus: 'unpaid' });
	});

	it('keeps the order and lets the guest retry when PayMongo cannot be reached', async () => {
		mocks.state.failCheckout = true;
		const res = await run(() => orderPage.actions.place!(placeEvent(hotelA, body())) as any);
		expect(res.status).toBe(303);
		expect(res.redirect).toMatch(/&payerror=1$/);
		const code = res.redirect.match(/DN-[A-Z0-9]{4}/)![0];
		const [row] = await db.select().from(s.diningOrders).where(eq(s.diningOrders.code, code));
		expect(row!.status).toBe('pending_payment'); // waiting; the order page offers "Pay now"
	});

	it('pays at the restaurant only where the venue allows it', async () => {
		const [beer] = await db.select().from(s.diningMenuItems).where(eq(s.diningMenuItems.diningItemId, venue2));
		const res = await run(() => orderPage.actions.place!(placeEvent(hotelA, body({ venueId: venue2, lines: [{ menuItemId: beer!.id, quantity: 1 }], payMode: 'venue' }))) as any);
		expect(res.status).toBe(409);
		expect(res.data.error).toMatch(/online payment only/);
	});

	// ---- the tracking page ---------------------------------------------------------------

	async function newOrder(over: Record<string, unknown> = {}) {
		return on.placeOnlineOrder({ hotelId: hotelA.id, venueId: venue, timezone: TZ, orderType: 'takeaway', date: day(1), time: '12:00', guestName: 'Track Guest', guestPhone: `0917${Math.floor(1000000 + Math.random() * 8999999)}`, payMode: 'online', lines: [{ menuItemId: adobo, quantity: 1, addonIds: [rice] }], ...over } as never);
	}
	const track = (hotel: any, code: string, token: string | null, qs = '') =>
		trackPage.load({ locals: as(hotel), params: { code }, url: new URL(`http://x/o?${token ? `t=${token}` : ''}${qs}`), depends: () => {} } as never) as Promise<any>;
	const trackEvent = (hotel: any, code: string, token: string, form: Record<string, string> = {}) =>
		({ locals: as(hotel), params: { code, hotel: hotel.slug }, url: new URL(`http://shop.test/o?t=${token}`), request: { formData: async () => { const f = new FormData(); for (const [k, v] of Object.entries(form)) f.set(k, v); return f; } } }) as never;
	const paid = (orderId: string, eventId: string) => ({ data: { id: eventId, attributes: { type: 'checkout_session.payment.paid', data: { id: 'cs_t', attributes: { metadata: { kind: 'dining', diningOrderId: orderId }, payments: [{ id: `pay_${eventId}`, attributes: { amount: 25_000, currency: 'PHP' } }] } } } } });

	it('shows an order only with its code and token, in its own hotel, and passes on the PayMongo hints', async () => {
		const o = await newOrder();
		const ok = await track(hotelA, o.code, o.accessToken, '&paid=1');
		expect(ok.order).toMatchObject({ code: o.code, status: 'pending_payment', needsPayment: true, canCancel: true, pickupNote: 'Collect at the counter' });
		expect(ok.returned).toEqual({ paid: true, cancelled: false, payError: false });
		expect((await track(hotelA, o.code, o.accessToken, '&cancelled=1&payerror=1')).returned).toEqual({ paid: false, cancelled: true, payError: true });
		await expect(track(hotelA, o.code, null)).rejects.toMatchObject({ status: 404 });
		await expect(track(hotelA, o.code, crypto.randomUUID())).rejects.toMatchObject({ status: 404 });
		await expect(track(hotelB, o.code, o.accessToken)).rejects.toMatchObject({ status: 404 });
	});

	it('lets a guest resume payment on a waiting order, with a fresh PayMongo link', async () => {
		const o = await newOrder();
		const res = await run(() => trackPage.actions.pay!(trackEvent(hotelA, o.code, o.accessToken)) as any);
		expect(res.status).toBe(303);
		expect(res.redirect).toMatch(/^https:\/\/pay\.test\//);
		expect((mocks.client.createCheckoutSession.mock.calls[0]![0] as any).success_url).toContain(`/dining/order/${o.code}?t=${o.accessToken}&paid=1`);
		// an order that is not waiting cannot be paid again
		await handlePaymongoEvent(paid(o.id, 'evt_g1'), { hotelId: hotelA.id });
		expect((await run(() => trackPage.actions.pay!(trackEvent(hotelA, o.code, o.accessToken)) as any)).data.error).toMatch(/not waiting for payment/);
		expect((await run(() => trackPage.actions.pay!(trackEvent(hotelB, o.code, o.accessToken)) as any)).status).toBe(404);
	});

	it('lets a guest cancel an unpaid order, and asks a paid one to go through the restaurant', async () => {
		const unpaid = await newOrder();
		expect(await run(() => trackPage.actions.cancel!(trackEvent(hotelA, unpaid.code, unpaid.accessToken)) as any)).toEqual({ cancelled: true });
		expect((await track(hotelA, unpaid.code, unpaid.accessToken)).order.status).toBe('cancelled');
		expect((await run(() => trackPage.actions.cancel!(trackEvent(hotelA, unpaid.code, unpaid.accessToken)) as any)).status).toBe(400);

		const p = await newOrder();
		await handlePaymongoEvent(paid(p.id, 'evt_g2'), { hotelId: hotelA.id });
		expect((await run(() => trackPage.actions.cancel!(trackEvent(hotelA, p.code, p.accessToken)) as any)).data.error).toMatch(/paid/);
		expect(await run(() => trackPage.actions.requestCancel!(trackEvent(hotelA, p.code, p.accessToken, { note: 'Plans changed' })) as any)).toEqual({ requested: true });
		const view = (await track(hotelA, p.code, p.accessToken)).order;
		expect(view).toMatchObject({ cancelRequested: true, canRequestCancel: false });
		expect(view.messages[0].body).toMatch(/Plans changed/);
		expect((await run(() => trackPage.actions.requestCancel!(trackEvent(hotelA, p.code, p.accessToken)) as any)).data.error).toMatch(/already asked/);
	});

	it('takes a guest message, refusing an empty or foreign one', async () => {
		const o = await newOrder();
		expect(await run(() => trackPage.actions.message!(trackEvent(hotelA, o.code, o.accessToken, { body: 'Is there parking?' })) as any)).toEqual({ sent: true });
		expect((await track(hotelA, o.code, o.accessToken)).order.messages.map((m: any) => m.body)).toEqual(['Is there parking?']);
		expect((await run(() => trackPage.actions.message!(trackEvent(hotelA, o.code, o.accessToken, { body: '   ' })) as any)).status).toBe(400);
		expect((await run(() => trackPage.actions.message!(trackEvent(hotelA, o.code, crypto.randomUUID(), { body: 'hi' })) as any)).status).toBe(400);
		expect((await run(() => trackPage.actions.message!(trackEvent(hotelB, o.code, o.accessToken, { body: 'hi' })) as any)).status).toBe(400);
	});
});
