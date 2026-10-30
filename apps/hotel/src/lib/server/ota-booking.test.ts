import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

/**
 * Live-DB tests for keying in an OTA booking (prepaid at the OTA): the booking carries the OTA's gross
 * rather than our rate plan's price, no cash moves, and each room's bill sits on the order's city-ledger
 * account so check-out is not blocked. Own throwaway hotel, removed afterwards; skipped without a database.
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

describe.skipIf(!hasDb)('OTA booking (live DB)', async () => {
	const { db } = await import('./db/index');
	const s = await import('./db/schema/index');
	const { mintRef } = await import('./ids');
	const { seedFinanceDefaults } = await import('./finance/seed-defaults');
	const { businessDateFor } = await import('./finance/shared');
	const { createWalkInBooking } = await import('./front-desk');
	const { getFolioDetail } = await import('./folio');
	const { openReceivable } = await import('./finance/receivables');
	const { openShift } = await import('./finance/shifts');
	const { recordOtaPayout } = await import('./finance/ota');
	const { listReceivables } = await import('./finance/receivables');
	const { cancelBooking, cancelOtaBooking, markNoShow } = await import('./cancellation');

	const tag = `ota-${Math.random().toString(36).slice(2, 10)}`;
	const today = businessDateFor('Asia/Manila');
	const day = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
	let hotelId = '';
	let roomTypeId = '';
	let ratePlanId = '';
	const roomIds: string[] = [];

	beforeAll(async () => {
		const [h] = await db.insert(s.hotels).values({ slug: tag, name: 'OTA test', orgRef: mintRef('org') }).returning();
		hotelId = h!.id;
		await seedFinanceDefaults(db, hotelId);
		const [rt] = await db.insert(s.roomTypes).values({ hotelId, name: 'Standard' }).returning();
		roomTypeId = rt!.id;
		const [plan] = await db.insert(s.ratePlans).values({ hotelId, roomTypeId, name: 'Rack', basePriceCentavos: 300_000 }).returning();
		ratePlanId = plan!.id;
		for (const n of ['101', '102']) {
			const [r] = await db.insert(s.rooms).values({ hotelId, roomTypeId, roomNumber: n } as never).returning();
			roomIds.push(r!.id);
		}
	});

	afterAll(async () => {
		if (!hotelId) return;
		const bookingIds = (await db.select({ id: s.bookings.id }).from(s.bookings).where(eq(s.bookings.hotelId, hotelId))).map((r) => r.id);
		if (bookingIds.length) await db.delete(s.bookingRooms).where(inArray(s.bookingRooms.bookingId, bookingIds));
		await db.delete(s.hotels).where(eq(s.hotels.id, hotelId));
	});

	const book = (reference: string, grossCentavos: number, commissionCentavos: number, roomCount = 1, start = 1) =>
		createWalkInBooking({
			hotelId,
			businessDate: today,
			guest: { fullName: 'Agoda Guest', email: '', phone: null, specialRequests: null },
			rooms: [{ roomTypeId, ratePlanId, checkIn: day(start), checkOut: day(start + 2), occupancy: 2, roomCount } as never],
			ota: { name: ' Agoda ', reference, grossCentavos, commissionCentavos },
			actor: null
		});

	it('stores the OTA gross, books no cash, and leaves the receivable at the gross', async () => {
		const { orderId, bookingIds } = await book('AG-1', 777_777, 116_667);
		const [order] = await db.select().from(s.orders).where(eq(s.orders.id, orderId));
		expect(order).toMatchObject({ otaName: 'agoda', otaReference: 'AG-1', totalCentavos: 777_777, otaNetCentavos: 661_110 });

		expect(await db.select().from(s.cashMovements).where(eq(s.cashMovements.hotelId, hotelId))).toHaveLength(0);

		const [acct] = await db.select().from(s.receivables).where(eq(s.receivables.orderId, orderId));
		expect(acct).toMatchObject({ originalAmountCentavos: 777_777, outstandingCentavos: 777_777, status: 'open' });
		expect(bookingIds).toHaveLength(1);
	});

	it('shares the gross across several rooms exactly and leaves every folio at zero', async () => {
		const { orderId, bookingIds } = await book('AG-2', 1_000_001, 150_000, 2, 10);
		expect(bookingIds).toHaveLength(2);
		const totals = await db.select({ t: s.bookings.totalCentavos }).from(s.bookings).where(eq(s.bookings.orderId, orderId));
		expect(totals.reduce((a, b) => a + b.t, 0)).toBe(1_000_001);
		for (const bookingId of bookingIds) {
			expect((await getFolioDetail(hotelId, { kind: 'room', bookingId })).balanceCentavos).toBe(0);
		}
		const [acct] = await db.select().from(s.receivables).where(eq(s.receivables.orderId, orderId));
		expect(acct!.outstandingCentavos).toBe(1_000_001);
		const entries = await db.select().from(s.receivableEntries).where(eq(s.receivableEntries.receivableId, acct!.id));
		expect(entries).toHaveLength(2);
	});

	it('refuses a reused reference for the same OTA (any case) and a commission at or above the gross', async () => {
		await book('AG-3', 500_000, 50_000, 1, 20);
		await expect(book('AG-3', 500_000, 50_000, 1, 20)).rejects.toThrow();
		await expect(book('AG-4', 500_000, 500_000, 1, 20)).rejects.toThrow(/commission/i);
	});

	// Regression for the `addToCityLedger` extraction: the manager's check-out override still works.
	it('openReceivable still moves a part-paid walk-in balance to the city ledger without touching cash', async () => {
		const settings = (await db.select().from(s.financeSettings).where(eq(s.financeSettings.hotelId, hotelId)))[0]!;
		await openShift({ hotelId, cashAccountId: settings.defaultDrawerAccountId!, businessDate: today, openingFloatCentavos: 0, actor: null });
		const { bookingIds, orderId } = await createWalkInBooking({
			hotelId,
			businessDate: today,
			guest: { fullName: 'Walk In', email: 'walk@example.test', phone: null, specialRequests: null },
			rooms: [{ roomTypeId, ratePlanId, checkIn: day(30), checkOut: day(32), occupancy: 2, roomCount: 1 } as never],
			payment: { method: 'cash', tenderedCentavos: 100_000 },
			actor: null
		});
		const target = { kind: 'room' as const, bookingId: bookingIds[0]! };
		const movementsBefore = (await db.select().from(s.cashMovements).where(eq(s.cashMovements.hotelId, hotelId))).length;
		const before = (await getFolioDetail(hotelId, target)).balanceCentavos;
		expect(before).toBeGreaterThan(0);

		const r = await openReceivable({ hotelId, target, billToName: 'ACME Corp', actor: null });
		expect(r.amountCentavos).toBe(before);
		expect((await getFolioDetail(hotelId, target)).balanceCentavos).toBe(0);
		const [acct] = await db.select().from(s.receivables).where(eq(s.receivables.orderId, orderId));
		expect(acct).toMatchObject({ billToName: 'ACME Corp', outstandingCentavos: before, status: 'open' });
		expect((await db.select().from(s.cashMovements).where(eq(s.cashMovements.hotelId, hotelId))).length).toBe(movementsBefore);
	});

	it('cancelling OTA rooms releases them, takes their share off the receivable and never refunds', async () => {
		const { orderId, bookingIds } = await book('AG-5', 600_000, 90_000, 2, 40);
		const [acct0] = await db.select().from(s.receivables).where(eq(s.receivables.orderId, orderId));
		const movementsBefore = (await db.select().from(s.cashMovements).where(eq(s.cashMovements.hotelId, hotelId))).length;

		const first = await cancelOtaBooking({ hotelId, bookingId: bookingIds[0]!, reason: 'Guest cancelled on Agoda', outcome: 'cancelled', actor: null });
		expect(first.orderCancelled).toBe(false);
		const [bk0] = await db.select().from(s.bookings).where(eq(s.bookings.id, bookingIds[0]!));
		expect(bk0!.status).toBe('cancelled');
		const [acct1] = await db.select().from(s.receivables).where(eq(s.receivables.id, acct0!.id));
		expect(acct1).toMatchObject({ status: 'open', outstandingCentavos: 600_000 - bk0!.totalCentavos });
		expect(await db.select().from(s.receivableEntries).where(eq(s.receivableEntries.receivableId, acct0!.id))).toHaveLength(1);

		const last = await cancelOtaBooking({ hotelId, bookingId: bookingIds[1]!, reason: 'No-show at the hotel', outcome: 'no_show', actor: null });
		expect(last.orderCancelled).toBe(true);
		const [acct2] = await db.select().from(s.receivables).where(eq(s.receivables.id, acct0!.id));
		expect(acct2).toMatchObject({ status: 'written_off', outstandingCentavos: 0 });
		expect((await db.select().from(s.cashMovements).where(eq(s.cashMovements.hotelId, hotelId))).length).toBe(movementsBefore);
	});

	it('keeps an OTA booking out of the refund and no-show flows', async () => {
		const { bookingIds } = await book('AG-6', 400_000, 40_000, 1, 50);
		const target = { kind: 'room' as const, bookingId: bookingIds[0]! };
		await expect(
			cancelBooking({ hotelId, target, reason: 'x', feeCentavos: 0, refundMethod: 'cash', actor: null } as never)
		).rejects.toThrow(/OTA/);
		await expect(markNoShow(hotelId, bookingIds[0]!, null)).rejects.toThrow(/OTA/);
	});

	it('a payout collects the net into the bank and writes the commission off, one cash movement per booking', async () => {
		const a = await book('AG-7', 500_000, 75_000, 1, 60);
		const b = await book('AG-8', 300_000, 45_000, 1, 62);
		const recv = async (orderId: string) => (await db.select().from(s.receivables).where(eq(s.receivables.orderId, orderId)))[0]!;
		const ra = await recv(a.orderId);
		const rb = await recv(b.orderId);
		const before = (await db.select().from(s.cashMovements).where(eq(s.cashMovements.hotelId, hotelId))).length;

		await expect(
			recordOtaPayout({ hotelId, statementRef: 'ST-1', items: [{ receivableId: ra.id, netReceivedCentavos: 500_001 }], actor: null })
		).rejects.toThrow(/more than/);
		// Nothing moved on the failed attempt.
		expect((await db.select().from(s.cashMovements).where(eq(s.cashMovements.hotelId, hotelId))).length).toBe(before);

		const out = await recordOtaPayout({
			hotelId,
			statementRef: 'ST-1',
			// The second is short-paid by 5.00: the extra comes off as more commission.
			items: [
				{ receivableId: ra.id, netReceivedCentavos: 425_000 },
				{ receivableId: rb.id, netReceivedCentavos: 254_500 }
			],
			actor: null
		});
		expect(out).toEqual({ collectedCentavos: 679_500, commissionCentavos: 120_500 });

		const moves = (await db.select().from(s.cashMovements).where(eq(s.cashMovements.hotelId, hotelId))).filter(
			(m) => m.sourceType === 'receivable_settlement' && [ra.id, rb.id].includes(m.sourceId ?? '')
		);
		expect(moves).toHaveLength(2);
		expect(moves.every((m) => m.direction === 'in' && m.category === 'room_revenue')).toBe(true);
		expect(moves.reduce((n, m) => n + m.amountCentavos, 0)).toBe(679_500);
		expect(await recv(a.orderId)).toMatchObject({ status: 'written_off', outstandingCentavos: 0 });
		await expect(
			recordOtaPayout({ hotelId, statementRef: 'ST-2', items: [{ receivableId: ra.id, netReceivedCentavos: 1 }], actor: null })
		).rejects.toThrow(/closed/);
	});

	it('keeps OTA accounts out of the city ledger list and gives the OTA list their details', async () => {
		const o = await book('AG-9', 250_000, 25_000, 1, 70);
		const ledger = await listReceivables(hotelId, { status: 'active' });
		expect(ledger.some((r) => r.orderId === o.orderId)).toBe(false);
		const ota = await listReceivables(hotelId, { status: 'active', ota: 'only' });
		const row = ota.find((r) => r.orderId === o.orderId);
		expect(row?.ota).toMatchObject({ name: 'agoda', reference: 'AG-9', grossCentavos: 250_000, netCentavos: 225_000, guestName: 'Agoda Guest', checkIn: day(70), checkOut: day(72) });
	});
});
