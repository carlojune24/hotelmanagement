import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';

/**
 * Live-DB tests for the cancellation grace tier end to end: the quote the cancel dialog is
 * prefilled from, then `cancelBooking` itself — folio write-off, the refund payment row, the cash
 * movement and the bank balance must all agree. Own throwaway hotel; skipped without a database.
 * Booking total is ₱4,000.00 (400000), guest paid a ₱2,000.00 downpayment by card.
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

describe.skipIf(!hasDb)('cancellation grace tier (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { getCancellationQuote, cancelBooking } = await import('./cancellation');
	const folio = await import('./folio');
	const pay = await import('./finance/payments');
	const { seedFinanceDefaults } = await import('./finance/seed-defaults');
	const { openShift } = await import('./finance/shifts');
	const { businessDateFor } = await import('./finance/shared');
	const { listBookingTransactions } = await import('./booking-transactions');
	const { trialBalance } = await import('./finance/ledger-reports');

	const tag = `cxl-${Math.random().toString(36).slice(2, 10)}`;
	const TOTAL = 400_000;
	const PAID = 200_000;
	const hour = 3_600_000;
	let hotelId = '';
	let roomTypeId = '';
	let bankId = '';
	const today = businessDateFor('Asia/Manila');
	const dayOffset = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 24 * hour).toISOString().slice(0, 10);

	/** Grace 24h @ 10%, no free window, forfeit afterwards — the policy the hotel actually wants. */
	async function mkPlan(over: Partial<typeof s.cancellationPolicies.$inferInsert> = {}) {
		const [policy] = await db
			.insert(s.cancellationPolicies)
			.values({
				hotelId,
				name: 'Grace',
				freeCancelHours: null,
				penaltyType: 'full_amount',
				graceHoursAfterPayment: 24,
				graceFeeBps: 1000,
				...over
			})
			.returning();
		const [plan] = await db
			.insert(s.ratePlans)
			.values({ hotelId, roomTypeId, name: `Plan ${policy!.id.slice(0, 4)}`, basePriceCentavos: TOTAL, cancellationPolicyId: policy!.id })
			.returning();
		return plan!.id;
	}

	/** A 1-room booking, paid `paid` by card `paidHoursAgo` hours back (0 paid = unpaid pending line). */
	async function mkBooking(opts: { ratePlanId: string; checkInOffsetDays: number; paid: number; paidHoursAgo: number }) {
		const [guest] = await db.insert(s.guests).values({ hotelId, fullName: 'Gina Guest', email: `${tag}@example.test` }).returning();
		const confirmed = opts.paid > 0;
		const [order] = await db
			.insert(s.orders)
			.values({ hotelId, guestId: guest!.id, status: confirmed ? 'confirmed' : 'pending_payment', subtotalCentavos: TOTAL, feesCentavos: 0, vatCentavos: 0, totalCentavos: TOTAL, accessToken: randomUUID() })
			.returning();
		const [booking] = await db
			.insert(s.bookings)
			.values({
				hotelId,
				orderId: order!.id,
				checkIn: dayOffset(opts.checkInOffsetDays),
				checkOut: dayOffset(opts.checkInOffsetDays + 2),
				occupancy: 2,
				status: confirmed ? 'confirmed' : 'pending_payment',
				subtotalCentavos: TOTAL,
				feesCentavos: 0,
				vatCentavos: 0,
				totalCentavos: TOTAL
			})
			.returning();
		await db.insert(s.bookingRooms).values({ bookingId: booking!.id, roomTypeId, ratePlanId: opts.ratePlanId, quantity: 1 } as never);
		const target = { kind: 'room' as const, bookingId: booking!.id };
		if (confirmed) {
			const r = await pay.recordPayment({ hotelId, target, method: 'card', amountCentavos: opts.paid, referenceNo: 'REF-1', actor: null });
			// Age the payment: the grace clock is read from payments.paid_at.
			await db
				.update(s.payments)
				.set({ paidAt: new Date(Date.now() - opts.paidHoursAgo * hour) })
				.where(eq(s.payments.orderId, order!.id));
			void r;
		}
		return { bookingId: booking!.id, orderId: order!.id, target };
	}

	const bankBalance = async () => (await db.select().from(s.cashAccounts).where(eq(s.cashAccounts.id, bankId)))[0]!.currentBalanceCentavos;

	/** Quote → cancel with the suggested fee → assert every money surface agrees. */
	async function cancelWithQuote(b: Awaited<ReturnType<typeof mkBooking>>, expectFee: number) {
		const quote = await getCancellationQuote(hotelId, b.target);
		expect(quote!.fee.feeCentavos).toBe(expectFee);
		const paid = quote!.paidCentavos;
		const refund = paid - expectFee;
		const bankBefore = await bankBalance();

		const res = await cancelBooking({
			hotelId,
			target: b.target,
			feeCentavos: quote!.fee.feeCentavos,
			refundMethod: 'card',
			reason: 'test',
			actor: null
		});
		expect(res.feeCentavos).toBe(expectFee);
		expect(res.refundCentavos).toBe(refund);

		const [row] = await db.select().from(s.bookings).where(eq(s.bookings.id, b.bookingId));
		expect(row!.status).toBe('cancelled');
		const [order] = await db.select().from(s.orders).where(eq(s.orders.id, b.orderId));
		expect(order!.status).toBe('cancelled');

		// Folio nets to zero: the line is written down to the fee kept, and net payments equal that fee.
		expect((await folio.getFolioDetail(hotelId, b.target)).balanceCentavos).toBe(0);
		const pays = await db.select().from(s.payments).where(eq(s.payments.orderId, b.orderId));
		expect(pays.reduce((n, p) => n + p.amountCentavos, 0)).toBe(expectFee);

		// Booking Transactions page: the cancelled booking shows only the fee kept, nothing owed either way.
		const txn = (await listBookingTransactions(hotelId, { from: dayOffset(-3), to: dayOffset(12) })).find((r) => r.orderId === b.orderId)!;
		expect(txn.status).toBe('cancelled');
		expect(txn.paidCentavos).toBe(expectFee);
		expect(txn.balanceCentavos).toBe(0);

		// Cash side: refund moved out of the bank account, exactly once.
		expect(await bankBalance()).toBe(bankBefore - refund);
		if (refund > 0) {
			const refundPay = pays.find((p) => p.purpose === 'refund')!;
			const moves = await db.select().from(s.cashMovements).where(eq(s.cashMovements.paymentId, refundPay.id));
			expect(moves).toHaveLength(1);
			expect(moves[0]!.direction).toBe('out');
			expect(moves[0]!.amountCentavos).toBe(refund);
		} else {
			expect(pays.some((p) => p.purpose === 'refund')).toBe(false);
		}
		return res;
	}

	beforeAll(async () => {
		const [h] = await db.insert(s.hotels).values({ slug: tag, name: 'Cancel test', orgRef: mintRef('org') }).returning();
		hotelId = h!.id;
		await seedFinanceDefaults(db, hotelId);
		const [rt] = await db.insert(s.roomTypes).values({ hotelId, name: 'Room' }).returning();
		roomTypeId = rt!.id;
		const settings = (await db.select().from(s.financeSettings).where(eq(s.financeSettings.hotelId, hotelId)))[0]!;
		bankId = settings.defaultBankAccountId!;
		await openShift({ hotelId, cashAccountId: settings.defaultDrawerAccountId!, businessDate: today, openingFloatCentavos: 0, actor: null });
	});

	afterAll(async () => {
		const stays = await db.select({ id: s.bookings.id }).from(s.bookings).where(eq(s.bookings.hotelId, hotelId));
		if (stays.length) await db.delete(s.bookingRooms).where(inArray(s.bookingRooms.bookingId, stays.map((b) => b.id)));
		await db.delete(s.hotels).where(eq(s.hotels.id, hotelId));
	});

	it('inside the grace period: keeps 10% of the total, refunds the rest of what was paid', async () => {
		const b = await mkBooking({ ratePlanId: await mkPlan(), checkInOffsetDays: 5, paid: PAID, paidHoursAgo: 2 });
		await cancelWithQuote(b, TOTAL / 10);
	});

	it('after the grace period: forfeits everything paid, refunds nothing', async () => {
		const b = await mkBooking({ ratePlanId: await mkPlan(), checkInOffsetDays: 5, paid: PAID, paidHoursAgo: 30 });
		await cancelWithQuote(b, PAID);
	});

	it('check-in time already passed: forfeits even when paid an hour ago', async () => {
		const b = await mkBooking({ ratePlanId: await mkPlan(), checkInOffsetDays: -1, paid: PAID, paidHoursAgo: 1 });
		await cancelWithQuote(b, PAID);
	});

	it('a staff-edited fee still settles correctly (waived inside grace)', async () => {
		const b = await mkBooking({ ratePlanId: await mkPlan(), checkInOffsetDays: 5, paid: PAID, paidHoursAgo: 2 });
		const bankBefore = await bankBalance();
		const res = await cancelBooking({ hotelId, target: b.target, feeCentavos: 0, refundMethod: 'card', reason: 'waived', actor: null });
		expect(res.refundCentavos).toBe(PAID);
		expect(await bankBalance()).toBe(bankBefore - PAID);
	});

	it('an unpaid pending booking quotes no fee and cancels without any money moving', async () => {
		const b = await mkBooking({ ratePlanId: await mkPlan(), checkInOffsetDays: 5, paid: 0, paidHoursAgo: 0 });
		const quote = await getCancellationQuote(hotelId, b.target);
		expect(quote!.fee.feeCentavos).toBe(0);
		const bankBefore = await bankBalance();
		const res = await cancelBooking({ hotelId, target: b.target, feeCentavos: 0, refundMethod: 'card', reason: 'unpaid', actor: null });
		expect(res.refundCentavos).toBe(0);
		expect(await bankBalance()).toBe(bankBefore);
	});

	it('a policy without a grace tier is unchanged (full amount forfeited)', async () => {
		const plan = await mkPlan({ graceHoursAfterPayment: null, graceFeeBps: null });
		const b = await mkBooking({ ratePlanId: plan, checkInOffsetDays: 5, paid: PAID, paidHoursAgo: 2 });
		await cancelWithQuote(b, PAID);
	});

	it('the double-entry ledger stays balanced after all of the above', async () => {
		const rows = await trialBalance({ hotelIds: [hotelId], dateFrom: dayOffset(-3), dateTo: dayOffset(12) });
		const debit = rows.reduce((n, r) => n + r.debitMinor, 0);
		const credit = rows.reduce((n, r) => n + r.creditMinor, 0);
		expect(debit).toBeGreaterThan(0);
		expect(debit).toBe(credit);
	});

	it('a free window still beats the grace tier', async () => {
		const plan = await mkPlan({ freeCancelHours: 48 });
		const b = await mkBooking({ ratePlanId: plan, checkInOffsetDays: 5, paid: PAID, paidHoursAgo: 2 });
		await cancelWithQuote(b, 0);
	});
});
