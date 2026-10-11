import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { stationIdFor } from '$lib/server/test-station';

/**
 * Live-DB tests for delivery on an online takeaway order: pickup is exactly what it always was,
 * delivery adds the venue's fee (VAT inside) to the total, and that one number agrees everywhere it
 * is used: PayMongo's checkout, the invoice/receipt, the printed bill and the sales report. PayMongo
 * is faked and so is the mailer. Own throwaway hotel, removed afterwards; skipped when no DATABASE_URL.
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
			return { id: `cs_deliv_${n}`, attributes: { checkout_url: `https://pay.test/checkout/${n}` } };
		}),
		expireCheckoutSession: vi.fn(async (_id: string) => ({}))
	};
	return { client };
});

vi.mock('./paymongo/client', async (orig) => ({
	...(await orig<typeof import('./paymongo/client')>()),
	getPaymongoClient: vi.fn(async () => mocks.client),
	isOnlinePaymentEnabled: vi.fn(async () => true)
}));
vi.mock('./email/send-dining-order', () => ({
	sendDiningOrderEmail: vi.fn(async () => ({ ok: true }))
}));

describe.skipIf(!hasDb)('online delivery and its fee (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const on = await import('./dining-online');
	const o = await import('./dining-orders');
	const { seedFinanceDefaults } = await import('./finance/seed-defaults');
	const { buildDiningSnapshot } = await import('./finance/documents');
	const { businessDateFor } = await import('./finance/shared');
	const { buildBill } = await import('../dining-bill');
	const { renderDiningOrder } = await import('./email/dining-order');

	const tag = `delivtest-${Math.random().toString(36).slice(2, 8)}`;
	const TZ = 'Asia/Manila';
	let hotelId = '';
	let venueId = '';
	let adobo = '';
	let soda = '';
	let phoneSeq = 0;
	const FEE = 6_000; // ₱60.00
	const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

	beforeAll(async () => {
		const [h] = await db
			.insert(s.hotels)
			.values({ slug: tag, name: 'Delivery test', orgRef: mintRef('org') })
			.returning();
		hotelId = h!.id;
		await seedFinanceDefaults(db, hotelId);
		const [v] = await db
			.insert(s.diningItems)
			.values({
				hotelId,
				title: 'Cafe',
				onlineOrdersEnabled: true,
				onlinePayment: 'online_or_venue',
				orderOpen: '00:00',
				orderClose: '23:45',
				prepMinutes: 20,
				deliveryEnabled: true,
				deliveryFeeCentavos: FEE
			})
			.returning();
		venueId = v!.id;
		const dishes = await db
			.insert(s.diningMenuItems)
			.values([
				{ hotelId, stationId: await stationIdFor(hotelId), diningItemId: venueId, name: 'Adobo', priceCentavos: 25_000 },
				{ hotelId, stationId: await stationIdFor(hotelId), diningItemId: venueId, name: 'Soda', priceCentavos: 8_000, taxable: false }
			])
			.returning();
		[adobo, soda] = dishes.map((d) => d.id) as [string, string];
	});

	afterAll(async () => {
		await db.delete(s.hotels).where(inArray(s.hotels.id, [hotelId]));
	});

	beforeEach(() => {
		mocks.client.createCheckoutSession.mockClear();
	});

	const place = (over: Record<string, unknown> = {}) =>
		on.placeOnlineOrder({
			hotelId,
			venueId,
			timezone: TZ,
			orderType: 'takeaway',
			date: day(1),
			time: '12:00',
			guestName: 'Deliver Guest',
			guestPhone: `0917${String(2000000 + ++phoneSeq)}`,
			guestEmail: 'dg@example.test',
			payMode: 'online',
			lines: [
				{ menuItemId: adobo, quantity: 2 },
				{ menuItemId: soda, quantity: 1 }
			],
			...over
		} as never);
	const row = async (id: string) => (await db.select().from(s.diningOrders).where(eq(s.diningOrders.id, id)))[0]!;
	const setVenue = (patch: Partial<typeof s.diningItems.$inferInsert>) =>
		db.update(s.diningItems).set(patch).where(eq(s.diningItems.id, venueId));

	// dishes: 2 × ₱250 (VAT-able) + ₱80 soda (exempt) = ₱580.00
	const DISHES = 58_000;

	it('leaves a pickup order exactly as it was: no fee, no address', async () => {
		const placed = await place();
		expect(placed.totalCentavos).toBe(DISHES);
		expect(await row(placed.id)).toMatchObject({
			orderType: 'takeaway',
			fulfilment: 'pickup',
			deliveryFeeCentavos: 0,
			deliveryAddress: null,
			totalCentavos: DISHES
		});
		// asking for delivery with pickup spelled out is the same thing
		const explicit = await place({ fulfilment: 'pickup', deliveryAddress: '1 Nowhere St, Davao' });
		expect(await row(explicit.id)).toMatchObject({ fulfilment: 'pickup', deliveryFeeCentavos: 0, deliveryAddress: null });
	});

	it("adds the venue's fee to a delivered order, with its VAT inside, and keeps the address", async () => {
		const placed = await place({ fulfilment: 'delivery', deliveryAddress: '  Unit 4, Palm St, Davao City ' });
		expect(placed.totalCentavos).toBe(DISHES + FEE);
		const r = await row(placed.id);
		expect(r).toMatchObject({
			orderType: 'takeaway',
			fulfilment: 'delivery',
			deliveryFeeCentavos: FEE,
			deliveryAddress: 'Unit 4, Palm St, Davao City',
			totalCentavos: DISHES + FEE
		});
		// 12% VAT inside the VAT-able dishes (₱500) and inside the fee, none in the soda
		const items = await db.select().from(s.diningOrderItems).where(eq(s.diningOrderItems.orderId, placed.id));
		const itemsVat = items.reduce((sum, i) => sum + i.vatCentavos, 0);
		const feeVat = Math.round((FEE * 1200) / 11200);
		expect(r.vatCentavos).toBe(itemsVat + feeVat);
		expect(items.reduce((sum, i) => sum + i.lineTotalCentavos, 0) + r.deliveryFeeCentavos).toBe(r.totalCentavos);
	});

	it('takes the fee from the venue, never from the guest, and follows a change to it', async () => {
		await setVenue({ deliveryFeeCentavos: 9_900 });
		const a = await place({ fulfilment: 'delivery', deliveryAddress: 'Unit 4, Palm St, Davao City', deliveryFeeCentavos: 1 });
		expect((await row(a.id)).deliveryFeeCentavos).toBe(9_900);
		await setVenue({ deliveryFeeCentavos: FEE });
		// the earlier order keeps what it was charged
		expect((await row(a.id)).deliveryFeeCentavos).toBe(9_900);
	});

	it('refuses delivery that is switched off, has no real address, or is not takeaway', async () => {
		await expect(place({ fulfilment: 'delivery', deliveryAddress: 'Palm' })).rejects.toThrow(/full address/i);
		await expect(place({ fulfilment: 'delivery' })).rejects.toThrow(/full address/i);
		await expect(place({ fulfilment: 'delivery', deliveryAddress: 'x'.repeat(301) })).rejects.toThrow(/too long/i);

		await setVenue({ deliveryEnabled: false });
		await expect(place({ fulfilment: 'delivery', deliveryAddress: 'Unit 4, Palm St, Davao City' })).rejects.toThrow(/does not deliver/i);
		// pickup is still available at a venue that does not deliver
		expect((await place()).totalCentavos).toBe(DISHES);
		await setVenue({ deliveryEnabled: true });

		// a pre-order is served at the table, so delivery does not apply to it
		await expect(
			o.createDiningOrder({
				hotelId,
				venueId,
				orderType: 'pre_order',
				lines: [{ menuItemId: adobo, quantity: 1 }],
				fulfilment: 'delivery',
				deliveryAddress: 'Unit 4, Palm St, Davao City',
				deliveryFeeCentavos: FEE
			} as never)
		).rejects.toThrow(/only a takeaway/i);
	});

	it('sends PayMongo the fee as its own line, so the session adds up to the total', async () => {
		const placed = await place({ fulfilment: 'delivery', deliveryAddress: 'Unit 4, Palm St, Davao City' });
		await on.startDiningCheckout({ hotelId, orderId: placed.id, hotelName: 'Delivery test', successUrl: 'https://x/ok', cancelUrl: 'https://x/no' });
		const attrs = mocks.client.createCheckoutSession.mock.calls[0]![0] as { line_items: { name: string; amount: number; quantity: number }[] };
		expect(attrs.line_items.map((l) => l.name)).toContain('Delivery fee');
		expect(attrs.line_items.reduce((sum, l) => sum + l.amount * l.quantity, 0)).toBe(DISHES + FEE);
		const [pending] = await db.select().from(s.diningPayments).where(eq(s.diningPayments.orderId, placed.id));
		expect(pending!.amountCentavos).toBe(DISHES + FEE);
	});

	it('puts the fee on the invoice as a VAT-able line that adds up to the total', async () => {
		const placed = await place({ fulfilment: 'delivery', deliveryAddress: 'Unit 4, Palm St, Davao City' });
		const snap = await buildDiningSnapshot(hotelId, placed.id, 'invoice');
		const fee = snap.lines.find((l) => l.description === 'Delivery fee')!;
		expect(fee).toMatchObject({ quantity: 1, amountCentavos: FEE, vatable: true });
		expect(snap.lines.reduce((sum, l) => sum + l.amountCentavos, 0)).toBe(DISHES + FEE);
		const t = snap.totals;
		expect(t.grossCentavos).toBe(DISHES + FEE);
		expect(t.vatableSalesCentavos + t.vatExemptSalesCentavos + t.vatCentavos).toBe(t.grossCentavos);
		expect(t.vatCentavos).toBe((await row(placed.id)).vatCentavos);

		// and a pickup order's invoice has no such line
		const pickup = await place();
		expect((await buildDiningSnapshot(hotelId, pickup.id, 'invoice')).lines.some((l) => l.description === 'Delivery fee')).toBe(false);
	});

	it('lists the fee on the printed bill so the lines add up to the total', async () => {
		const placed = await place({ fulfilment: 'delivery', deliveryAddress: 'Unit 4, Palm St, Davao City' });
		const r = await row(placed.id);
		const items = await db.select().from(s.diningOrderItems).where(eq(s.diningOrderItems.orderId, placed.id));
		const bill = buildBill([
			{
				id: r.id,
				code: r.code,
				status: 'new',
				paymentStatus: 'unpaid',
				totalCentavos: r.totalCentavos,
				vatCentavos: r.vatCentavos,
				deliveryFeeCentavos: r.deliveryFeeCentavos,
				items: items.map((i) => ({
					name: i.name,
					quantity: i.quantity,
					unitPriceCentavos: i.unitPriceCentavos,
					addonsCentavos: i.addonsCentavos,
					lineTotalCentavos: i.lineTotalCentavos,
					addons: []
				}))
			}
		]);
		expect(bill.lines.some((l) => l.description === 'Delivery fee' && l.lineTotalCentavos === FEE)).toBe(true);
		expect(bill.lines.reduce((sum, l) => sum + l.lineTotalCentavos, 0)).toBe(bill.totalCentavos);
		expect(bill.totalCentavos).toBe(DISHES + FEE);
	});

	it('counts the fee in sales without letting the station and dish breakdowns drift from the total', async () => {
		const date = businessDateFor(TZ);
		const mine = await place({ fulfilment: 'delivery', deliveryAddress: 'Unit 4, Palm St, Davao City' });
		await db
			.update(s.diningOrders)
			.set({ status: 'new', paymentStatus: 'paid', paymentMethod: 'gcash', businessDate: date })
			.where(eq(s.diningOrders.id, mine.id));

		const rep = await o.diningSalesReport(hotelId, date, date);
		expect(rep.grossCentavos).toBeGreaterThanOrEqual(DISHES + FEE);
		const fee = rep.byStation.find((st) => st.station === 'Delivery fee')!;
		expect(fee.grossCentavos).toBe(FEE);
		expect(rep.byStation.reduce((sum, st) => sum + st.grossCentavos, 0)).toBe(rep.grossCentavos);
		expect(rep.byItem.find((i) => i.name === 'Delivery fee')!.grossCentavos).toBe(FEE);
	});

	it("tells the guest about the fee and the address in the order email, and says 'delivery' not 'pickup'", () => {
		const base = {
			kind: 'confirmation' as const,
			hotel: { name: 'Hotel', address: null, city: null, contactEmail: null, contactPhone: null, logoUrl: null, accentColor: '#836819', paperColor: '#ffffff' },
			guestName: 'Deliver Guest',
			venueTitle: 'Cafe',
			code: 'DN-ABCD',
			orderType: 'takeaway',
			pickupDateLabel: 'Sat, Oct 10',
			pickupTimeLabel: '12:00 PM',
			items: [{ name: 'Adobo', quantity: 2, addons: [], remarks: null, lineTotalCentavos: 50_000 }],
			totalCentavos: 56_000,
			payment: 'paid' as const,
			remarks: null,
			pickupNote: 'Come to the front counter.',
			trackUrl: 'https://x/track'
		};
		const delivered = renderDiningOrder({ ...base, fulfilment: 'delivery', deliveryAddress: 'Unit 4, Palm St', deliveryFeeCentavos: 6_000 } as never);
		expect(delivered.html).toContain('Delivery fee');
		expect(delivered.html).toContain('Deliver to: Unit 4, Palm St');
		expect(delivered.html).not.toContain('Come to the front counter.');
		expect(delivered.text).toContain('Delivery: Sat, Oct 10, 12:00 PM');
		expect(delivered.text).toContain('Delivery fee  ₱60.00');

		const pickup = renderDiningOrder(base as never);
		expect(pickup.html).not.toContain('Delivery fee');
		expect(pickup.text).toContain('Pickup: Sat, Oct 10, 12:00 PM');
		expect(pickup.html).toContain('Come to the front counter.');
	});
});
