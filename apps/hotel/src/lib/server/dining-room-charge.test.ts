import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';

/**
 * Live-DB tests for charging dining to a room: the in-house guest list, the folio line, every
 * refusal, undoing it (from the dining side and from the folio), and how a payment of the folio is
 * split between dining and room revenue. Own throwaway hotels; skipped without a database.
 * Prices are VAT-inclusive at the hotel default of 12%.
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

describe.skipIf(!hasDb)('charge dining to a room (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const rc = await import('./dining-room-charge');
	const o = await import('./dining-orders');
	const folio = await import('./folio');
	const pay = await import('./finance/payments');
	const { seedFinanceDefaults } = await import('./finance/seed-defaults');
	const { openShift } = await import('./finance/shifts');
	const { daySnapshot } = await import('./finance/dayclose');
	const { revenueBySourceReport } = await import('./finance/reports');
	const { buildInvoiceSnapshot } = await import('./finance/documents');
	const { businessDateFor } = await import('./finance/shared');

	const tag = `roomcharge-${Math.random().toString(36).slice(2, 10)}`;
	const hotelIds: string[] = [];
	let hotelA: any;
	let hotelB: any;
	let venueA = '';
	let venueB = '';
	let roomTypeA = '';
	let ratePlanA = '';
	let roomTypeB = '';
	let ratePlanB = '';
	let bankId = '';
	const today = businessDateFor('Asia/Manila');
	let roomSeq = 100;

	async function mkHotel(suffix: string) {
		const [h] = await db.insert(s.hotels).values({ slug: `${tag}-${suffix}`, name: `Room charge ${suffix}`, orgRef: mintRef('org') }).returning();
		hotelIds.push(h!.id);
		return h!;
	}

	/** A guest staying in a room: order + booking + room assignment, base stay already paid so the folio starts balanced. */
	async function mkStay(
		hotel: any,
		over: { guestName?: string; status?: 'checked_in' | 'confirmed' | 'checked_out'; roomNumber?: string; total?: number; orderId?: string; guestId?: string } = {}
	) {
		const total = over.total ?? 100_000;
		const rt = hotel === hotelA ? roomTypeA : roomTypeB;
		const rp = hotel === hotelA ? ratePlanA : ratePlanB;
		const guestId =
			over.guestId ??
			(await db.insert(s.guests).values({ hotelId: hotel.id, fullName: over.guestName ?? 'Gina Guest', email: `${tag}@example.test` }).returning({ id: s.guests.id }))[0]!.id;
		const orderId =
			over.orderId ??
			(
				await db
					.insert(s.orders)
					.values({ hotelId: hotel.id, guestId, status: 'confirmed', subtotalCentavos: total, feesCentavos: 0, vatCentavos: 0, totalCentavos: total, accessToken: randomUUID() })
					.returning({ id: s.orders.id })
			)[0]!.id;
		const [booking] = await db
			.insert(s.bookings)
			.values({ hotelId: hotel.id, orderId, checkIn: today, checkOut: '2099-01-01', occupancy: 2, status: over.status ?? 'checked_in', subtotalCentavos: total, feesCentavos: 0, vatCentavos: 0, totalCentavos: total })
			.returning();
		const [br] = await db.insert(s.bookingRooms).values({ bookingId: booking!.id, roomTypeId: rt, ratePlanId: rp, quantity: 1 } as never).returning();
		const roomNumber = over.roomNumber ?? String(++roomSeq);
		const [room] = await db.insert(s.rooms).values({ hotelId: hotel.id, roomTypeId: rt, roomNumber }).returning();
		await db.insert(s.roomAssignments).values({ bookingRoomId: br!.id, roomId: room!.id, checkIn: today, checkOut: '2099-01-01' } as never);
		return { bookingId: booking!.id, orderId, guestId, roomNumber, total };
	}

	/** The base stay is paid in full up front (the usual case), so only new charges owe anything. */
	async function payBase(hotel: any, stay: { orderId: string; total: number }) {
		await db.insert(s.payments).values({ orderId: stay.orderId, provider: 'cash', method: 'cash', purpose: 'settlement', status: 'paid', amountCentavos: stay.total, paidAt: new Date() });
		void hotel;
	}

	let dishSeq = 0;
	/** A dining order for exactly `priceCentavos`, VAT-inclusive. */
	async function diningOrder(hotel: any, priceCentavos: number, taxable = true) {
		const venueId = hotel === hotelA ? venueA : venueB;
		const [dish] = await db.insert(s.diningMenuItems).values({ hotelId: hotel.id, diningItemId: venueId, name: `Dish ${++dishSeq}`, priceCentavos, taxable }).returning();
		return o.createDiningOrder({ hotelId: hotel.id, venueId, orderType: 'dine_in', lines: [{ menuItemId: dish!.id, quantity: 1 }] });
	}
	const orderRow = async (id: string) => (await db.select().from(s.diningOrders).where(eq(s.diningOrders.id, id)))[0]!;
	const target = (bookingId: string) => ({ kind: 'room' as const, bookingId });
	const charge = (hotel: any, orderId: string, bookingId: string) => rc.chargeDiningOrderToRoom({ hotelId: hotel.id, orderId, bookingId, actor: null });
	const balance = async (hotel: any, bookingId: string) => (await folio.getFolioDetail(hotel.id, target(bookingId))).balanceCentavos;
	const movementsOf = (paymentId: string) => db.select().from(s.cashMovements).where(eq(s.cashMovements.paymentId, paymentId));
	const cardPay = (hotel: any, bookingId: string, amountCentavos: number) =>
		pay.recordPayment({ hotelId: hotel.id, target: target(bookingId), method: 'card', amountCentavos, referenceNo: 'REF-1', actor: null });
	const bankBalance = async () => (await db.select().from(s.cashAccounts).where(eq(s.cashAccounts.id, bankId)))[0]!.currentBalanceCentavos;
	const diningRevenue = async (hotel: any) => (await revenueBySourceReport(hotel.id, today, today)).rows.find((r) => r.source === 'dining_revenue')?.amountCentavos ?? 0;

	beforeAll(async () => {
		hotelA = await mkHotel('a');
		hotelB = await mkHotel('b');
		for (const h of [hotelA, hotelB]) await seedFinanceDefaults(db, h.id);
		for (const h of [hotelA, hotelB]) {
			const [rt] = await db.insert(s.roomTypes).values({ hotelId: h.id, name: 'Room' }).returning();
			const [rp] = await db.insert(s.ratePlans).values({ hotelId: h.id, roomTypeId: rt!.id, name: 'Plan', basePriceCentavos: 100_000 }).returning();
			if (h === hotelA) [roomTypeA, ratePlanA] = [rt!.id, rp!.id];
			else [roomTypeB, ratePlanB] = [rt!.id, rp!.id];
		}
		const [va] = await db.insert(s.diningItems).values({ hotelId: hotelA.id, title: 'Cafe' }).returning();
		const [vb] = await db.insert(s.diningItems).values({ hotelId: hotelB.id, title: 'Other cafe' }).returning();
		venueA = va!.id;
		venueB = vb!.id;
		const settings = await db.select().from(s.financeSettings).where(eq(s.financeSettings.hotelId, hotelA.id));
		bankId = settings[0]!.defaultBankAccountId!;
		await openShift({ hotelId: hotelA.id, cashAccountId: settings[0]!.defaultDrawerAccountId!, businessDate: today, openingFloatCentavos: 0, actor: null });
	});

	afterAll(async () => {
		if (hotelIds.length) {
			// booking_rooms restrict-references rate plans, so clear them before the hotels (which cascade the rest).
			const stays = await db.select({ id: s.bookings.id }).from(s.bookings).where(inArray(s.bookings.hotelId, hotelIds));
			if (stays.length) await db.delete(s.bookingRooms).where(inArray(s.bookingRooms.bookingId, stays.map((b) => b.id)));
			await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
		}
	});

	// ---- who can be charged ----------------------------------------------------------------

	it('lists only guests staying right now, in this hotel, with their room and booking code', async () => {
		const inHouse = await mkStay(hotelA, { guestName: 'In House Ina', roomNumber: 'L-101' });
		await mkStay(hotelA, { guestName: 'Future Fred', status: 'confirmed', roomNumber: 'L-102' });
		await mkStay(hotelA, { guestName: 'Gone Gary', status: 'checked_out', roomNumber: 'L-103' });
		await mkStay(hotelB, { guestName: 'Other Hotel Olga', roomNumber: 'L-201' });
		const list = await rc.listInHouseGuests(hotelA.id);
		expect(list.map((g) => g.guestName)).toEqual(['In House Ina']);
		expect(list[0]).toMatchObject({ bookingId: inHouse.bookingId, roomNumber: 'L-101' });
		expect(list[0]!.bookingCode).toMatch(/^[0-9A-F]{8}$/);
		expect((await rc.listInHouseGuests(hotelB.id)).map((g) => g.guestName)).toEqual(['Other Hotel Olga']);
	});

	// ---- the charge --------------------------------------------------------------------------

	it('puts one line on the guest folio for the order total, with the VAT split out, and marks the order', async () => {
		const stay = await mkStay(hotelA, { guestName: 'Charge Chloe', roomNumber: 'C-1' });
		await payBase(hotelA, stay);
		expect(await balance(hotelA, stay.bookingId)).toBe(0);

		const order = await diningOrder(hotelA, 61_000); // taxable
		const r = await charge(hotelA, order.id, stay.bookingId);
		expect(r).toMatchObject({ roomLabel: 'C-1', guestName: 'Charge Chloe' });

		const vat = Math.round((61_000 * 1200) / 11_200);
		const [line] = await db.select().from(s.folioCharges).where(eq(s.folioCharges.id, r.chargeId));
		expect(line).toMatchObject({ source: 'dining', diningOrderId: order.id, quantity: 1, totalCentavos: 61_000, taxCentavos: vat, unitPriceCentavos: 61_000 - vat, isBaseCharge: false });
		expect(line!.description).toBe(`Dining ${order.code}, Cafe`);

		expect(await orderRow(order.id)).toMatchObject({ paymentStatus: 'room_charged', bookingId: stay.bookingId, roomLabel: 'C-1', folioChargeId: r.chargeId, guestName: 'Charge Chloe' });
		expect(await balance(hotelA, stay.bookingId)).toBe(61_000); // the guest now owes it
		const view = (await o.getDiningOrder(hotelA.id, order.id))!;
		expect(view).toMatchObject({ paymentStatus: 'room_charged', roomLabel: 'C-1' });
		expect(view.bookingCode).toMatch(/^[0-9A-F]{8}$/);
	});

	it('keeps a name already on the order, and shows the charge on the checkout invoice with its VAT', async () => {
		const stay = await mkStay(hotelA, { guestName: 'Invoice Ivy', roomNumber: 'C-2' });
		await payBase(hotelA, stay);
		const [dish] = await db.insert(s.diningMenuItems).values({ hotelId: hotelA.id, diningItemId: venueA, name: 'Named dish', priceCentavos: 11_200 }).returning();
		const named = await o.createDiningOrder({ hotelId: hotelA.id, venueId: venueA, orderType: 'dine_in', guestName: 'Visitor Vic', lines: [{ menuItemId: dish!.id, quantity: 1 }] });
		await charge(hotelA, named.id, stay.bookingId);
		expect((await orderRow(named.id)).guestName).toBe('Visitor Vic');

		const inv = await buildInvoiceSnapshot(hotelA.id, target(stay.bookingId));
		const line = inv.lines.find((l) => l.description.startsWith('Dining '))!;
		// Like every other taxable extra: the line shows the VAT-exclusive amount and the 12% is carried in the totals.
		expect(line).toMatchObject({ amountCentavos: 10_000, vatable: true });
		expect(inv.totals.vatCentavos).toBeGreaterThanOrEqual(1_200);
		expect(inv.totals.grossCentavos).toBeGreaterThanOrEqual(111_200); // the guest still owes the full ₱112.00 for the dish
	});

	it('refuses a guest who is not checked in, or from another hotel', async () => {
		const confirmed = await mkStay(hotelA, { status: 'confirmed', roomNumber: 'R-1' });
		const out = await mkStay(hotelA, { status: 'checked_out', roomNumber: 'R-2' });
		const foreign = await mkStay(hotelB, { roomNumber: 'R-3' });
		const order = await diningOrder(hotelA, 5_000);
		for (const b of [confirmed, out, foreign]) await expect(charge(hotelA, order.id, b.bookingId)).rejects.toThrow(/not checked in/);
		expect((await orderRow(order.id)).paymentStatus).toBe('unpaid');
		expect(await db.select().from(s.folioCharges).where(eq(s.folioCharges.diningOrderId, order.id))).toEqual([]);
	});

	it("refuses an order that is paid, cancelled, waiting for online payment, already charged, or another hotel's", async () => {
		const stay = await mkStay(hotelA, { roomNumber: 'R-4' });
		await payBase(hotelA, stay);
		const paid = await diningOrder(hotelA, 5_000);
		await o.payDiningOrder({ hotelId: hotelA.id, orderId: paid.id, method: 'card' });
		await expect(charge(hotelA, paid.id, stay.bookingId)).rejects.toThrow(/already been paid/);

		const cancelled = await diningOrder(hotelA, 5_000);
		await o.cancelDiningOrder({ hotelId: hotelA.id, orderId: cancelled.id, reason: 'x' });
		await expect(charge(hotelA, cancelled.id, stay.bookingId)).rejects.toThrow(/cancelled/);

		const [dish] = await db.insert(s.diningMenuItems).values({ hotelId: hotelA.id, diningItemId: venueA, name: 'Online dish', priceCentavos: 5_000 }).returning();
		const waiting = await o.createDiningOrder({ hotelId: hotelA.id, venueId: venueA, orderType: 'takeaway', source: 'online', payMode: 'online', initialStatus: 'pending_payment', lines: [{ menuItemId: dish!.id, quantity: 1 }] });
		await expect(charge(hotelA, waiting.id, stay.bookingId)).rejects.toThrow(/waiting for the guest to pay online/);

		const once = await diningOrder(hotelA, 5_000);
		await charge(hotelA, once.id, stay.bookingId);
		await expect(charge(hotelA, once.id, stay.bookingId)).rejects.toThrow(/already charged to a room/);
		const other = await mkStay(hotelA, { roomNumber: 'R-5' });
		await expect(charge(hotelA, once.id, other.bookingId)).rejects.toThrow(/already charged to a room/); // not onto a second room either

		const foreignOrder = await diningOrder(hotelB, 5_000);
		await expect(charge(hotelA, foreignOrder.id, stay.bookingId)).rejects.toThrow(/could not be found/);
	});

	it('refuses once the guest bill is closed', async () => {
		const stay = await mkStay(hotelA, { roomNumber: 'R-6' });
		await folio.getFolioDetail(hotelA.id, target(stay.bookingId));
		await folio.closeFolio(hotelA.id, stay.bookingId);
		const order = await diningOrder(hotelA, 5_000);
		await expect(charge(hotelA, order.id, stay.bookingId)).rejects.toThrow(/bill is closed/);
	});

	it('never charges the same order twice, even at the same moment', async () => {
		const stay = await mkStay(hotelA, { roomNumber: 'R-7' });
		await payBase(hotelA, stay);
		const order = await diningOrder(hotelA, 7_000);
		const results = await Promise.allSettled([1, 2, 3, 4].map(() => charge(hotelA, order.id, stay.bookingId)));
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		expect(await db.select().from(s.folioCharges).where(and(eq(s.folioCharges.diningOrderId, order.id), eq(s.folioCharges.source, 'dining')))).toHaveLength(1);
		expect(await balance(hotelA, stay.bookingId)).toBe(7_000);
	});

	it('blocks paying or cancelling an order that sits on a room bill, with a clear way out', async () => {
		const stay = await mkStay(hotelA, { roomNumber: 'R-8' });
		await payBase(hotelA, stay);
		const order = await diningOrder(hotelA, 9_000);
		await charge(hotelA, order.id, stay.bookingId);
		await expect(o.payDiningOrder({ hotelId: hotelA.id, orderId: order.id, method: 'card' })).rejects.toThrow(/charged to a room bill/);
		await expect(o.cancelDiningOrder({ hotelId: hotelA.id, orderId: order.id, reason: 'x' })).rejects.toThrow(/Take it off the room bill/);
		await expect(o.voidDiningOrderPayment({ hotelId: hotelA.id, orderId: order.id, reason: 'x' })).rejects.toThrow(/no payment to void/);
	});

	// ---- undoing it --------------------------------------------------------------------------

	it('takes an order off the bill from the dining side: the line is voided and the order is unpaid again', async () => {
		const stay = await mkStay(hotelA, { roomNumber: 'U-1' });
		await payBase(hotelA, stay);
		const order = await diningOrder(hotelA, 20_000);
		const r = await charge(hotelA, order.id, stay.bookingId);
		await expect(rc.undoDiningRoomCharge({ hotelId: hotelA.id, orderId: order.id, reason: '  ', actor: null })).rejects.toThrow(/reason/);
		await rc.undoDiningRoomCharge({ hotelId: hotelA.id, orderId: order.id, reason: 'Wrong room', actor: null });

		expect(await orderRow(order.id)).toMatchObject({ paymentStatus: 'unpaid', bookingId: null, roomLabel: null, folioChargeId: null });
		const [line] = await db.select().from(s.folioCharges).where(eq(s.folioCharges.id, r.chargeId));
		expect(line!.voidedAt).not.toBeNull();
		expect(line!.voidReason).toMatch(/Wrong room/);
		expect(await balance(hotelA, stay.bookingId)).toBe(0);
		await expect(rc.undoDiningRoomCharge({ hotelId: hotelA.id, orderId: order.id, reason: 'again', actor: null })).rejects.toThrow(/not charged to a room/);

		// freed, so it can be charged again to the right room
		const right = await mkStay(hotelA, { roomNumber: 'U-2' });
		await payBase(hotelA, right);
		await charge(hotelA, order.id, right.bookingId);
		expect(await balance(hotelA, right.bookingId)).toBe(20_000);
	});

	it('also resets the order when the front desk voids the line from the folio', async () => {
		const stay = await mkStay(hotelA, { roomNumber: 'U-3' });
		await payBase(hotelA, stay);
		const order = await diningOrder(hotelA, 15_000);
		const r = await charge(hotelA, order.id, stay.bookingId);
		await folio.voidFolioCharge(hotelA.id, target(stay.bookingId), r.chargeId, 'Guest disputed it', null);
		expect(await orderRow(order.id)).toMatchObject({ paymentStatus: 'unpaid', bookingId: null, roomLabel: null, folioChargeId: null });
		expect(await balance(hotelA, stay.bookingId)).toBe(0);
		// an unrelated charge voided the same way leaves orders alone
		const plain = await folio.addAdHocCharge(hotelA.id, target(stay.bookingId), { description: 'Laundry', amountCentavos: 3_000, taxable: false }, null);
		await folio.voidFolioCharge(hotelA.id, target(stay.bookingId), plain.chargeId, null, null);
	});

	it("won't undo after check-out or once part of the dining bill has been paid", async () => {
		const settledStay = await mkStay(hotelA, { roomNumber: 'U-4' });
		await payBase(hotelA, settledStay);
		const a = await diningOrder(hotelA, 40_000);
		await charge(hotelA, a.id, settledStay.bookingId);
		await cardPay(hotelA, settledStay.bookingId, 10_000); // part-paid: dining settlement has begun
		await expect(rc.undoDiningRoomCharge({ hotelId: hotelA.id, orderId: a.id, reason: 'x', actor: null })).rejects.toThrow(/already been paid/);

		const outStay = await mkStay(hotelA, { roomNumber: 'U-5' });
		await payBase(hotelA, outStay);
		const b = await diningOrder(hotelA, 10_000);
		await charge(hotelA, b.id, outStay.bookingId);
		await folio.closeFolio(hotelA.id, outStay.bookingId);
		await expect(rc.undoDiningRoomCharge({ hotelId: hotelA.id, orderId: b.id, reason: 'x', actor: null })).rejects.toThrow(/checked out/);
	});

	// ---- settling the bill: dining income vs room income --------------------------------------

	it('books a payment that clears only dining as dining revenue, nothing as room revenue', async () => {
		const stay = await mkStay(hotelA, { roomNumber: 'S-1' });
		await payBase(hotelA, stay);
		const before = await diningRevenue(hotelA);
		const order = await diningOrder(hotelA, 61_000);
		await charge(hotelA, order.id, stay.bookingId);
		const bankBefore = await bankBalance();

		const p = await cardPay(hotelA, stay.bookingId, 61_000);
		const moves = await movementsOf(p.paymentId);
		expect(moves.map((m) => [m.category, m.amountCentavos])).toEqual([['dining_revenue', 61_000]]);
		expect((await db.select().from(s.payments).where(eq(s.payments.id, p.paymentId)))[0]!.diningCentavos).toBe(61_000);
		expect(await bankBalance()).toBe(bankBefore + 61_000);
		expect(await diningRevenue(hotelA)).toBe(before + 61_000);
		expect(await balance(hotelA, stay.bookingId)).toBe(0);
	});

	it('splits a full settlement of a mixed bill: dining part to dining revenue, the rest to room revenue', async () => {
		const stay = await mkStay(hotelA, { roomNumber: 'S-2' });
		await payBase(hotelA, stay);
		const order = await diningOrder(hotelA, 60_000);
		await charge(hotelA, order.id, stay.bookingId);
		await folio.addAdHocCharge(hotelA.id, target(stay.bookingId), { description: 'Laundry', amountCentavos: 40_000, taxable: false }, null);
		expect(await balance(hotelA, stay.bookingId)).toBe(100_000);

		const p = await cardPay(hotelA, stay.bookingId, 100_000);
		const moves = await movementsOf(p.paymentId);
		expect(moves.map((m) => [m.category, m.amountCentavos]).sort()).toEqual([['dining_revenue', 60_000], ['room_revenue', 40_000]].sort());
		expect(moves.every((m) => m.paymentId === p.paymentId)).toBe(true);
		expect(moves.reduce((sum, m) => sum + m.amountCentavos, 0)).toBe(100_000); // the payment total is untouched
	});

	it('shares part-payments pro-rata and clears dining exactly across the payments', async () => {
		const stay = await mkStay(hotelA, { roomNumber: 'S-3' });
		await payBase(hotelA, stay);
		const order = await diningOrder(hotelA, 33_333); // awkward amounts on purpose
		await charge(hotelA, order.id, stay.bookingId);
		await folio.addAdHocCharge(hotelA.id, target(stay.bookingId), { description: 'Minibar', amountCentavos: 66_667, taxable: false }, null);

		const p1 = await cardPay(hotelA, stay.bookingId, 50_000);
		const p2 = await cardPay(hotelA, stay.bookingId, 30_000);
		const p3 = await cardPay(hotelA, stay.bookingId, 20_000);
		const dining = async (id: string) => (await db.select().from(s.payments).where(eq(s.payments.id, id)))[0]!.diningCentavos;
		const [d1, d2, d3] = [await dining(p1.paymentId), await dining(p2.paymentId), await dining(p3.paymentId)];
		expect(d1).toBe(Math.round((50_000 * 33_333) / 100_000)); // 50% of the bill, so about half of the dining
		expect(d1 + d2 + d3).toBe(33_333); // the final payment clears dining to the centavo
		expect(await balance(hotelA, stay.bookingId)).toBe(0);
		// every payment's movements add up to the payment
		for (const p of [p1, p2, p3]) {
			expect((await movementsOf(p.paymentId)).reduce((sum, m) => sum + m.amountCentavos, 0)).toBe(p.appliedCentavos);
		}
	});

	it('leaves a folio with no dining charges exactly as before: one movement, no dining share', async () => {
		const stay = await mkStay(hotelA, { roomNumber: 'S-4' });
		await payBase(hotelA, stay);
		await folio.addAdHocCharge(hotelA.id, target(stay.bookingId), { description: 'Laundry', amountCentavos: 25_000, taxable: false }, null);
		const p = await cardPay(hotelA, stay.bookingId, 25_000);
		const moves = await movementsOf(p.paymentId);
		expect(moves.map((m) => [m.category, m.amountCentavos])).toEqual([['room_revenue', 25_000]]);
		expect((await db.select().from(s.payments).where(eq(s.payments.id, p.paymentId)))[0]!.diningCentavos).toBe(0);
	});

	it('ignores a voided dining charge when splitting a payment', async () => {
		const stay = await mkStay(hotelA, { roomNumber: 'S-5' });
		await payBase(hotelA, stay);
		const order = await diningOrder(hotelA, 50_000);
		const r = await charge(hotelA, order.id, stay.bookingId);
		await folio.addAdHocCharge(hotelA.id, target(stay.bookingId), { description: 'Laundry', amountCentavos: 10_000, taxable: false }, null);
		await folio.voidFolioCharge(hotelA.id, target(stay.bookingId), r.chargeId, null, null);
		const p = await cardPay(hotelA, stay.bookingId, 10_000);
		expect((await movementsOf(p.paymentId)).map((m) => m.category)).toEqual(['room_revenue']);
	});

	it('reverses both movements when the payment is voided, and re-splits the next payment correctly', async () => {
		const stay = await mkStay(hotelA, { roomNumber: 'S-6' });
		await payBase(hotelA, stay);
		const order = await diningOrder(hotelA, 60_000);
		await charge(hotelA, order.id, stay.bookingId);
		await folio.addAdHocCharge(hotelA.id, target(stay.bookingId), { description: 'Laundry', amountCentavos: 40_000, taxable: false }, null);
		const bankBefore = await bankBalance();
		const diningBefore = await diningRevenue(hotelA);

		const p = await cardPay(hotelA, stay.bookingId, 100_000);
		expect(await bankBalance()).toBe(bankBefore + 100_000);
		await pay.voidPayment(hotelA.id, p.paymentId, 'Wrong card', null);
		expect(await bankBalance()).toBe(bankBefore); // both movements reversed
		expect(await diningRevenue(hotelA)).toBe(diningBefore);
		expect((await movementsOf(p.paymentId)).every((m) => m.voidedAt !== null)).toBe(true);

		// the voided payment no longer counts as having settled dining: paying again splits as new
		const again = await cardPay(hotelA, stay.bookingId, 100_000);
		expect((await movementsOf(again.paymentId)).map((m) => [m.category, m.amountCentavos]).sort()).toEqual([['dining_revenue', 60_000], ['room_revenue', 40_000]].sort());
	});

	it('splits a payment across the rooms of one booking, each room by its own dining', async () => {
		const first = await mkStay(hotelA, { roomNumber: 'M-1', total: 100_000 });
		const second = await mkStay(hotelA, { roomNumber: 'M-2', total: 100_000, orderId: first.orderId, guestId: first.guestId });
		await payBase(hotelA, { orderId: first.orderId, total: 200_000 });
		const order = await diningOrder(hotelA, 50_000);
		await charge(hotelA, order.id, first.bookingId); // dining on room 1
		await folio.addAdHocCharge(hotelA.id, target(second.bookingId), { description: 'Laundry', amountCentavos: 30_000, taxable: false }, null);

		const p = await pay.recordOrderPayment({
			hotelId: hotelA.id,
			orderId: first.orderId,
			method: 'card',
			referenceNo: 'REF-2',
			allocations: [
				{ target: target(first.bookingId), amountCentavos: 50_000 },
				{ target: target(second.bookingId), amountCentavos: 30_000 }
			],
			actor: null
		});
		const moves = await movementsOf(p.paymentId);
		expect(moves.map((m) => [m.category, m.amountCentavos]).sort()).toEqual([['dining_revenue', 50_000], ['room_revenue', 30_000]].sort());
		const allocs = await db.select().from(s.paymentAllocations).where(eq(s.paymentAllocations.paymentId, p.paymentId));
		expect(allocs.find((a) => a.bookingId === first.bookingId)).toMatchObject({ amountCentavos: 50_000, diningCentavos: 50_000 });
		expect(allocs.find((a) => a.bookingId === second.bookingId)).toMatchObject({ amountCentavos: 30_000, diningCentavos: 0 });
		expect((await db.select().from(s.payments).where(eq(s.payments.id, p.paymentId)))[0]!.diningCentavos).toBe(50_000);
		expect(await balance(hotelA, first.bookingId)).toBe(0);
		expect(await balance(hotelA, second.bookingId)).toBe(0);
	});

	it('counts dining revenue in the day-close totals and keeps room-charged sales out of Finance until paid', async () => {
		const stay = await mkStay(hotelA, { roomNumber: 'F-1' });
		await payBase(hotelA, stay);
		const diningBefore = (await daySnapshot(hotelA.id, today)).byCategory['in:dining_revenue'] ?? 0;
		const order = await diningOrder(hotelA, 12_000);
		await charge(hotelA, order.id, stay.bookingId);
		// charged, not paid: the Sales tab counts the sale, Finance cash does not yet
		expect((await daySnapshot(hotelA.id, today)).byCategory['in:dining_revenue'] ?? 0).toBe(diningBefore);
		const report = await o.diningSalesReport(hotelA.id, today, today);
		expect(report.byMethod.find((m) => m.method === 'room_charge')?.grossCentavos).toBeGreaterThanOrEqual(12_000);

		await cardPay(hotelA, stay.bookingId, 12_000);
		const after = await daySnapshot(hotelA.id, today);
		expect(after.byCategory['in:dining_revenue']).toBe(diningBefore + 12_000);
		expect(after.grossRevenueCentavos).toBeGreaterThanOrEqual(after.byCategory['in:dining_revenue']!);
	});

	it("keeps another hotel's room charges out of this hotel's report", async () => {
		expect((await o.diningSalesReport(hotelB.id, today, today)).byMethod.find((m) => m.method === 'room_charge')).toBeUndefined();
	});
});
