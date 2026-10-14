import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';

/**
 * Live-DB tests for the security deposit shown to a guest during online booking: which rate plans
 * carry one, and what an order's rooms add up to. The deposit is display-only, so these also pin
 * that an order's own totals never move. Own throwaway hotels, removed afterwards; skipped when no
 * DATABASE_URL is configured.
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

describe.skipIf(!hasDb)('security deposit shown on online booking (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const lookup = await import('./security-deposit-lookup');

	const tag = `depositlookup-${Math.random().toString(36).slice(2, 10)}`;
	const hotelIds: string[] = [];
	let hotelA = '';
	let hotelB = '';
	let roomTypeA = '';
	let planWithDeposit = '';
	let planWithZero = '';
	let planWithout = '';
	let planOtherHotel = '';
	let guestA = '';

	async function mkHotel(suffix: string) {
		const [h] = await db
			.insert(s.hotels)
			.values({ slug: `${tag}-${suffix}`, name: `Deposit lookup ${suffix}`, orgRef: mintRef('org') })
			.returning({ id: s.hotels.id });
		hotelIds.push(h!.id);
		return h!.id;
	}

	async function mkPlan(hotelId: string, roomTypeId: string, name: string, policyId: string | null) {
		const [p] = await db
			.insert(s.ratePlans)
			.values({ hotelId, roomTypeId, name, basePriceCentavos: 100_000, securityDepositPolicyId: policyId })
			.returning({ id: s.ratePlans.id });
		return p!.id;
	}

	async function mkOrder(hotelId: string, lines: { planId: string; quantity: number; status?: 'confirmed' | 'cancelled' }[]) {
		const [o] = await db
			.insert(s.orders)
			.values({
				hotelId,
				guestId: guestA,
				status: 'confirmed',
				subtotalCentavos: 100_000,
				feesCentavos: 0,
				vatCentavos: 12_000,
				totalCentavos: 112_000,
				accessToken: randomUUID()
			})
			.returning({ id: s.orders.id });
		for (const l of lines) {
			const [b] = await db
				.insert(s.bookings)
				.values({
					hotelId,
					orderId: o!.id,
					status: l.status ?? 'confirmed',
					checkIn: '2031-06-01',
					checkOut: '2031-06-02',
					occupancy: 2,
					subtotalCentavos: 100_000,
					feesCentavos: 0,
					vatCentavos: 12_000,
					totalCentavos: 112_000
				})
				.returning({ id: s.bookings.id });
			await db.insert(s.bookingRooms).values({
				bookingId: b!.id,
				roomTypeId: roomTypeA,
				ratePlanId: l.planId,
				quantity: l.quantity
			} as never);
		}
		return o!.id;
	}

	beforeAll(async () => {
		hotelA = await mkHotel('a');
		hotelB = await mkHotel('b');
		const [rt] = await db.insert(s.roomTypes).values({ hotelId: hotelA, name: 'Deluxe' }).returning();
		const [rtB] = await db.insert(s.roomTypes).values({ hotelId: hotelB, name: 'Other' }).returning();
		roomTypeA = rt!.id;
		const [dp] = await db
			.insert(s.securityDepositPolicies)
			.values({ hotelId: hotelA, name: 'Standard', amountCentavos: 100_000 })
			.returning();
		const [zero] = await db
			.insert(s.securityDepositPolicies)
			.values({ hotelId: hotelA, name: 'Waived', amountCentavos: 0 })
			.returning();
		const [dpB] = await db
			.insert(s.securityDepositPolicies)
			.values({ hotelId: hotelB, name: 'Other', amountCentavos: 500_000 })
			.returning();
		planWithDeposit = await mkPlan(hotelA, roomTypeA, 'Flexible', dp!.id);
		planWithZero = await mkPlan(hotelA, roomTypeA, 'Waived', zero!.id);
		planWithout = await mkPlan(hotelA, roomTypeA, 'Plain', null);
		planOtherHotel = await mkPlan(hotelB, rtB!.id, 'Elsewhere', dpB!.id);
		const [g] = await db.insert(s.guests).values({ hotelId: hotelA, fullName: 'Deposit Guest', email: 'dg@example.com' }).returning();
		guestA = g!.id;
	});

	afterAll(async () => {
		if (hotelIds.length === 0) return;
		await db.delete(s.bookings).where(inArray(s.bookings.hotelId, hotelIds));
		await db.delete(s.orders).where(inArray(s.orders.hotelId, hotelIds));
		await db.delete(s.guests).where(inArray(s.guests.hotelId, hotelIds));
		await db.delete(s.ratePlans).where(inArray(s.ratePlans.hotelId, hotelIds));
		await db.delete(s.securityDepositPolicies).where(inArray(s.securityDepositPolicies.hotelId, hotelIds));
		await db.delete(s.roomTypes).where(inArray(s.roomTypes.hotelId, hotelIds));
		await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
	});

	it('maps only the rate plans that have a deposit, leaving out none, zero and foreign plans', async () => {
		const m = await lookup.securityDepositByRatePlan(hotelA, [planWithDeposit, planWithZero, planWithout, planOtherHotel]);
		expect([...m.entries()]).toEqual([[planWithDeposit, 100_000]]);
		expect((await lookup.securityDepositByRatePlan(hotelA, [])).size).toBe(0);
	});

	it("adds up an order's rooms: deposit × rooms on each line, cancelled lines left out", async () => {
		const orderId = await mkOrder(hotelA, [
			{ planId: planWithDeposit, quantity: 2 },
			{ planId: planWithout, quantity: 1 },
			{ planId: planWithDeposit, quantity: 1, status: 'cancelled' }
		]);
		expect(await lookup.orderSecurityDepositCentavos(hotelA, orderId)).toBe(200_000);
	});

	it('is zero for an order with no deposit, and never resolves across hotels', async () => {
		const plain = await mkOrder(hotelA, [{ planId: planWithout, quantity: 3 }]);
		expect(await lookup.orderSecurityDepositCentavos(hotelA, plain)).toBe(0);

		const withDeposit = await mkOrder(hotelA, [{ planId: planWithDeposit, quantity: 1 }]);
		expect(await lookup.orderSecurityDepositCentavos(hotelB, withDeposit)).toBe(0);
	});

	it('leaves the order totals alone: the deposit is a memo, not a charge', async () => {
		const orderId = await mkOrder(hotelA, [{ planId: planWithDeposit, quantity: 2 }]);
		await lookup.orderSecurityDepositCentavos(hotelA, orderId);
		const [o] = await db.select().from(s.orders).where(inArray(s.orders.id, [orderId]));
		expect(o!.totalCentavos).toBe(112_000);
		expect(o!.vatCentavos).toBe(12_000);
	});
});
