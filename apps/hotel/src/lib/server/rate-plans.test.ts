import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';

/**
 * Live-DB tests for issues RATES-001 / RATES-002 / RATES-003 (see issues.md). They create two
 * throwaway hotels under a random slug, exercise the guards against them, and delete only what
 * they created — they never read or modify any other hotel's rows. Skipped when no DATABASE_URL
 * is configured (same pattern as the roster tests).
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

describe.skipIf(!hasDb)('rates & policies scoping and limits (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { RatePlanScopeError, assertPlanRefsInHotel, assertRatePlanInHotel } = await import(
		'./rate-plans'
	);
	const { PromoLimitError, assertPromoWithinLimits } = await import('./promo-codes');
	const { priceStay } = await import('./pricing');

	const tag = `ratestest-${Math.random().toString(36).slice(2, 10)}`;
	const hotelIds: string[] = [];
	let hotelA = '';
	let hotelB = '';
	const ids = {
		rtA: '',
		rtB: '',
		cpA: '',
		cpB: '',
		dpA: '',
		dpB: '',
		planA: '',
		planB: ''
	};

	async function mkHotel(suffix: string) {
		const [h] = await db
			.insert(s.hotels)
			.values({ slug: `${tag}-${suffix}`, name: `Rates test ${suffix}`, orgRef: mintRef('org') })
			.returning({ id: s.hotels.id });
		hotelIds.push(h!.id);
		return h!.id;
	}

	async function mkCatalog(hotelId: string, base: number) {
		const [rt] = await db
			.insert(s.roomTypes)
			.values({ hotelId, name: 'Test room' })
			.returning({ id: s.roomTypes.id });
		const [cp] = await db
			.insert(s.cancellationPolicies)
			.values({ hotelId, name: 'Test policy' })
			.returning({ id: s.cancellationPolicies.id });
		const [dp] = await db
			.insert(s.securityDepositPolicies)
			.values({ hotelId, name: 'Test deposit', amountCentavos: 100000 })
			.returning({ id: s.securityDepositPolicies.id });
		const [plan] = await db
			.insert(s.ratePlans)
			.values({ hotelId, roomTypeId: rt!.id, name: 'Test plan', basePriceCentavos: base })
			.returning({ id: s.ratePlans.id });
		return { rt: rt!.id, cp: cp!.id, dp: dp!.id, plan: plan!.id };
	}

	beforeAll(async () => {
		hotelA = await mkHotel('a');
		hotelB = await mkHotel('b');
		const a = await mkCatalog(hotelA, 100_000);
		const b = await mkCatalog(hotelB, 200_000);
		Object.assign(ids, {
			rtA: a.rt,
			cpA: a.cp,
			dpA: a.dp,
			planA: a.plan,
			rtB: b.rt,
			cpB: b.cp,
			dpB: b.dp,
			planB: b.plan
		});
	});

	afterAll(async () => {
		if (hotelIds.length === 0) return;
		// Children first: redemptions → bookings → orders → guests, then the catalog, then hotels.
		await db.delete(s.promoRedemptions).where(inArray(s.promoRedemptions.hotelId, hotelIds));
		await db.delete(s.bookings).where(inArray(s.bookings.hotelId, hotelIds));
		await db.delete(s.orders).where(inArray(s.orders.hotelId, hotelIds));
		await db.delete(s.guests).where(inArray(s.guests.hotelId, hotelIds));
		await db.delete(s.promoCodes).where(inArray(s.promoCodes.hotelId, hotelIds));
		await db.delete(s.dailyRates).where(inArray(s.dailyRates.hotelId, hotelIds));
		await db.delete(s.seasonalRates).where(inArray(s.seasonalRates.hotelId, hotelIds));
		await db.delete(s.ratePlans).where(inArray(s.ratePlans.hotelId, hotelIds));
		await db.delete(s.cancellationPolicies).where(inArray(s.cancellationPolicies.hotelId, hotelIds));
		await db
			.delete(s.securityDepositPolicies)
			.where(inArray(s.securityDepositPolicies.hotelId, hotelIds));
		await db.delete(s.roomTypes).where(inArray(s.roomTypes.hotelId, hotelIds));
		await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
	});

	// ------------------------------------------------------------------ RATES-001
	describe('assertRatePlanInHotel (RATES-001)', () => {
		it('accepts a rate plan that belongs to the hotel', async () => {
			await expect(assertRatePlanInHotel(hotelA, ids.planA)).resolves.toBeUndefined();
		});
		it("rejects another hotel's rate plan", async () => {
			await expect(assertRatePlanInHotel(hotelA, ids.planB)).rejects.toBeInstanceOf(
				RatePlanScopeError
			);
			await expect(assertRatePlanInHotel(hotelB, ids.planA)).rejects.toBeInstanceOf(
				RatePlanScopeError
			);
		});
		it('rejects an id that does not exist', async () => {
			await expect(assertRatePlanInHotel(hotelA, randomUUID())).rejects.toBeInstanceOf(
				RatePlanScopeError
			);
		});
	});

	describe('pricing ignores rows written under another hotel (RATES-001, defence in depth)', () => {
		const checkIn = '2031-03-10';
		const checkOut = '2031-03-12'; // two nights: 03-10 and 03-11

		it('control: a plan with no overrides prices at its base rate', async () => {
			const p = await priceStay({ hotelId: hotelB, ratePlanId: ids.planB, checkIn, checkOut });
			expect(p.nights.map((n) => n.priceCentavos)).toEqual([200_000, 200_000]);
		});

		it("a daily override planted under hotel A on hotel B's plan does not change B's price", async () => {
			await db.insert(s.dailyRates).values({
				hotelId: hotelA, // the attacker's hotel
				ratePlanId: ids.planB, // the victim's plan
				date: '2031-03-10',
				priceCentavos: 100
			});
			const p = await priceStay({ hotelId: hotelB, ratePlanId: ids.planB, checkIn, checkOut });
			expect(p.nights.map((n) => n.priceCentavos)).toEqual([200_000, 200_000]);
		});

		it("a seasonal rate planted under hotel A on hotel B's plan does not change B's price", async () => {
			await db.insert(s.seasonalRates).values({
				hotelId: hotelA,
				ratePlanId: ids.planB,
				name: 'Planted',
				startDate: '2031-03-01',
				endDate: '2031-03-31',
				priceCentavos: 100
			});
			const p = await priceStay({ hotelId: hotelB, ratePlanId: ids.planB, checkIn, checkOut });
			expect(p.nights.map((n) => n.priceCentavos)).toEqual([200_000, 200_000]);
		});

		it("still applies a hotel's own override to its own plan", async () => {
			await db.insert(s.dailyRates).values({
				hotelId: hotelB,
				ratePlanId: ids.planB,
				date: '2031-03-11',
				priceCentavos: 300_000
			});
			const p = await priceStay({ hotelId: hotelB, ratePlanId: ids.planB, checkIn, checkOut });
			expect(p.nights.find((n) => n.date === '2031-03-11')?.priceCentavos).toBe(300_000);
			// …and the planted row for 03-10 is still ignored.
			expect(p.nights.find((n) => n.date === '2031-03-10')?.priceCentavos).toBe(200_000);
		});
	});

	// ------------------------------------------------------------------ RATES-003
	describe('assertPlanRefsInHotel (RATES-003)', () => {
		it("accepts the hotel's own room type and policies", async () => {
			await expect(
				assertPlanRefsInHotel(hotelA, {
					roomTypeId: ids.rtA,
					cancellationPolicyId: ids.cpA,
					securityDepositPolicyId: ids.dpA
				})
			).resolves.toBeUndefined();
		});
		it('treats blank / missing references as "none"', async () => {
			await expect(assertPlanRefsInHotel(hotelA, {})).resolves.toBeUndefined();
			await expect(
				assertPlanRefsInHotel(hotelA, { cancellationPolicyId: '', securityDepositPolicyId: null })
			).resolves.toBeUndefined();
		});
		it("rejects another hotel's room type", async () => {
			await expect(assertPlanRefsInHotel(hotelA, { roomTypeId: ids.rtB })).rejects.toThrow(
				/room type/i
			);
		});
		it("rejects another hotel's cancellation policy", async () => {
			await expect(assertPlanRefsInHotel(hotelA, { cancellationPolicyId: ids.cpB })).rejects.toThrow(
				/cancellation policy/i
			);
		});
		it("rejects another hotel's security deposit policy", async () => {
			await expect(
				assertPlanRefsInHotel(hotelA, { securityDepositPolicyId: ids.dpB })
			).rejects.toThrow(/security deposit policy/i);
		});
	});

	// ------------------------------------------------------------------ RATES-002
	describe('assertPromoWithinLimits (RATES-002)', () => {
		type Limits = { maxRedemptions?: number | null; maxPerEmail?: number | null };
		let n = 0;

		async function mkPromo(limits: Limits) {
			n += 1;
			const [p] = await db
				.insert(s.promoCodes)
				.values({
					hotelId: hotelA,
					code: `${tag}-P${n}`.toUpperCase().slice(0, 40),
					discountType: 'percentage',
					discountBps: 1000,
					maxRedemptions: limits.maxRedemptions ?? null,
					maxPerEmail: limits.maxPerEmail ?? null
				})
				.returning({ id: s.promoCodes.id, code: s.promoCodes.code });
			return p!;
		}

		/** One guest + order + booking + a redemption of `promo` — i.e. one "use" of the code. */
		async function redeem(
			promo: { id: string; code: string },
			email: string,
			opts: { orderStatus?: 'pending_payment' | 'confirmed' | 'cancelled'; voided?: boolean } = {},
			runner: Pick<typeof db, 'insert'> = db
		) {
			const [g] = await runner
				.insert(s.guests)
				.values({ hotelId: hotelA, fullName: 'Test Guest', email })
				.returning({ id: s.guests.id });
			const [o] = await runner
				.insert(s.orders)
				.values({
					hotelId: hotelA,
					guestId: g!.id,
					status: opts.orderStatus ?? 'confirmed',
					subtotalCentavos: 100_000,
					feesCentavos: 0,
					vatCentavos: 12_000,
					totalCentavos: 112_000,
					accessToken: randomUUID()
				})
				.returning({ id: s.orders.id });
			const [b] = await runner
				.insert(s.bookings)
				.values({
					hotelId: hotelA,
					orderId: o!.id,
					checkIn: '2031-05-01',
					checkOut: '2031-05-02',
					occupancy: 2,
					subtotalCentavos: 100_000,
					feesCentavos: 0,
					vatCentavos: 12_000,
					totalCentavos: 112_000
				})
				.returning({ id: s.bookings.id });
			await runner.insert(s.promoRedemptions).values({
				hotelId: hotelA,
				promoCodeId: promo.id,
				bookingId: b!.id,
				code: promo.code,
				discountCentavos: 11_200,
				voidedAt: opts.voided ? new Date() : null
			});
		}

		const check = (promoId: string, email: string) =>
			db.transaction((tx) => assertPromoWithinLimits(tx, promoId, email));

		it('has no effect on a code with no limits, however often it was used', async () => {
			const p = await mkPromo({});
			await redeem(p, 'a@example.com');
			await redeem(p, 'a@example.com');
			await expect(check(p.id, 'a@example.com')).resolves.toBeUndefined();
		});

		it('blocks once maxRedemptions is reached', async () => {
			const p = await mkPromo({ maxRedemptions: 2 });
			await expect(check(p.id, 'x@example.com')).resolves.toBeUndefined();
			await redeem(p, 'one@example.com');
			await expect(check(p.id, 'x@example.com')).resolves.toBeUndefined();
			await redeem(p, 'two@example.com');
			await expect(check(p.id, 'x@example.com')).rejects.toBeInstanceOf(PromoLimitError);
		});

		it('counts a multi-room order as one use', async () => {
			const p = await mkPromo({ maxRedemptions: 2 });
			// Two redemption rows on the SAME order (a two-room booking) = one use.
			const [g] = await db
				.insert(s.guests)
				.values({ hotelId: hotelA, fullName: 'Multi', email: 'multi@example.com' })
				.returning({ id: s.guests.id });
			const [o] = await db
				.insert(s.orders)
				.values({
					hotelId: hotelA,
					guestId: g!.id,
					subtotalCentavos: 200_000,
					feesCentavos: 0,
					vatCentavos: 24_000,
					totalCentavos: 224_000,
					accessToken: randomUUID()
				})
				.returning({ id: s.orders.id });
			for (let i = 0; i < 2; i++) {
				const [b] = await db
					.insert(s.bookings)
					.values({
						hotelId: hotelA,
						orderId: o!.id,
						checkIn: '2031-05-01',
						checkOut: '2031-05-02',
						occupancy: 2,
						subtotalCentavos: 100_000,
						feesCentavos: 0,
						vatCentavos: 12_000,
						totalCentavos: 112_000
					})
					.returning({ id: s.bookings.id });
				await db.insert(s.promoRedemptions).values({
					hotelId: hotelA,
					promoCodeId: p.id,
					bookingId: b!.id,
					code: p.code,
					discountCentavos: 5_600
				});
			}
			await expect(check(p.id, 'next@example.com')).resolves.toBeUndefined();
		});

		it('gives a use back when the order was cancelled or the redemption voided', async () => {
			const p = await mkPromo({ maxRedemptions: 1 });
			await redeem(p, 'gone@example.com', { orderStatus: 'cancelled' });
			await redeem(p, 'void@example.com', { voided: true });
			await expect(check(p.id, 'new@example.com')).resolves.toBeUndefined();
		});

		it('enforces maxPerEmail, case-insensitively, without blocking other guests', async () => {
			const p = await mkPromo({ maxPerEmail: 1 });
			await redeem(p, 'Guest@Example.com');
			await expect(check(p.id, ' guest@example.COM ')).rejects.toBeInstanceOf(PromoLimitError);
			await expect(check(p.id, 'someone-else@example.com')).resolves.toBeUndefined();
		});

		it('lets exactly one of two simultaneous checkouts take the last use', async () => {
			const p = await mkPromo({ maxRedemptions: 1 });
			const attempt = (email: string) =>
				db.transaction(async (tx) => {
					await assertPromoWithinLimits(tx, p.id, email);
					// Hold the transaction open long enough that, without the row lock, both
					// attempts would pass the check before either records its redemption.
					await new Promise((r) => setTimeout(r, 200));
					await redeem(p, email, {}, tx);
				});
			const results = await Promise.allSettled([
				attempt('racer1@example.com'),
				attempt('racer2@example.com')
			]);
			const ok = results.filter((r) => r.status === 'fulfilled');
			const rejected = results.filter((r) => r.status === 'rejected');
			expect(ok).toHaveLength(1);
			expect(rejected).toHaveLength(1);
			expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(PromoLimitError);
		});
	});
});
