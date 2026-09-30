import { fail } from '@sveltejs/kit';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import {
	cancellationPenaltyType,
	cancellationPolicies,
	promoCodes,
	promoDiscountType,
	ratePlans,
	roomTypes,
	securityDepositPolicies
} from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { listDistinctInclusions } from '$lib/server/rate-plans';
import { normalizePromoCode, MAX_PROMO_CODE_LENGTH } from '$lib/server/promo-codes';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'hotel:admin');
	const hotelId = locals.hotel!.id;

	const types = await db
		.select({ id: roomTypes.id, name: roomTypes.name })
		.from(roomTypes)
		.where(eq(roomTypes.hotelId, hotelId))
		.orderBy(asc(roomTypes.name));

	const policies = await db
		.select()
		.from(cancellationPolicies)
		.where(eq(cancellationPolicies.hotelId, hotelId))
		.orderBy(asc(cancellationPolicies.name));

	const depositPolicies = await db
		.select()
		.from(securityDepositPolicies)
		.where(eq(securityDepositPolicies.hotelId, hotelId))
		.orderBy(asc(securityDepositPolicies.name));

	const plans = await db
		.select({
			id: ratePlans.id,
			name: ratePlans.name,
			roomTypeId: ratePlans.roomTypeId,
			cancellationPolicyId: ratePlans.cancellationPolicyId,
			securityDepositPolicyId: ratePlans.securityDepositPolicyId,
			basePriceCentavos: ratePlans.basePriceCentavos,
			isActive: ratePlans.isActive
		})
		.from(ratePlans)
		.where(eq(ratePlans.hotelId, hotelId))
		.orderBy(asc(ratePlans.name));
	const roomTypeName = new Map(types.map((t) => [t.id, t.name]));
	const policyName = new Map(policies.map((c) => [c.id, c.name]));
	const depositPolicyName = new Map(depositPolicies.map((c) => [c.id, c.name]));
	const inclusionSuggestions = await listDistinctInclusions(hotelId);

	const promos = await db
		.select()
		.from(promoCodes)
		.where(and(eq(promoCodes.hotelId, hotelId), isNull(promoCodes.deletedAt)))
		.orderBy(asc(promoCodes.code));

	return {
		roomTypes: types,
		cancellationPolicies: policies,
		securityDepositPolicies: depositPolicies,
		promoCodes: promos,
		inclusionSuggestions,
		ratePlans: plans.map((p) => ({
			...p,
			roomTypeName: roomTypeName.get(p.roomTypeId) ?? '—',
			cancellationPolicyName: p.cancellationPolicyId
				? (policyName.get(p.cancellationPolicyId) ?? '—')
				: null,
			securityDepositPolicyName: p.securityDepositPolicyId
				? (depositPolicyName.get(p.securityDepositPolicyId) ?? '—')
				: null
		}))
	};
};

const createPolicySchema = z.object({
	name: z.string().min(2).max(120),
	description: z.string().max(2000).optional(),
	freeCancelHours: z.coerce.number().int().min(0).max(8760).optional(),
	penaltyType: z.enum(cancellationPenaltyType.enumValues),
	penaltyValueBps: z.coerce.number().int().min(0).max(10000).optional(),
	/** Percent of the total the guest pays online to confirm (1–100); blank or 100 = pay in full. */
	downpaymentPct: z.preprocess(
		(v) => (v === '' || v == null ? undefined : v),
		z.coerce.number().min(1).max(100).optional()
	)
});
/** Stored as basis points; null means "pay in full" (blank and 100% are the same thing). */
const downpaymentBpsFrom = (pct: number | undefined) =>
	pct == null || pct >= 100 ? null : Math.round(pct * 100);
const updatePolicySchema = createPolicySchema.extend({ id: z.string().uuid() });

const createDepositPolicySchema = z.object({
	name: z.string().min(2).max(120),
	description: z.string().max(2000).optional(),
	amountPhp: z.coerce.number().min(0)
});
const updateDepositPolicySchema = createDepositPolicySchema.extend({ id: z.string().uuid() });

/** Empty form fields post `""`; treat that (and null) as "not provided" before coercion. */
const blankToUndef = (v: unknown) => (v === '' || v == null ? undefined : v);
const optMoney = z.preprocess(blankToUndef, z.coerce.number().min(0).optional());
const optNights = z.preprocess(blankToUndef, z.coerce.number().int().min(1).max(365).optional());
/** A `<input type="datetime-local">` value ("YYYY-MM-DDTHH:MM") → a UTC Date. Deliberately
 *  UTC rather than the hotel's own timezone (this app has no wall-time→zone conversion
 *  helper the other direction, only `businessDateFor`'s UTC→local one) — the field is
 *  labelled "(UTC)" in the UI so an admin isn't guessing which clock it means. */
const optUtcDateTime = z.preprocess(
	(v) => (v === '' || v == null ? undefined : `${v}:00Z`),
	z.coerce.date().optional()
);

const createPlanSchema = z.object({
	roomTypeId: z.string().uuid(),
	cancellationPolicyId: z.string().uuid().optional(),
	securityDepositPolicyId: z.string().uuid().optional(),
	name: z.string().min(2).max(120),
	description: z.string().max(2000).optional(),
	inclusionsCsv: z.string().max(500).optional(),
	basePricePhp: z.coerce.number().min(0),
	extraPersonFeePhp: optMoney,
	extraBedFeePhp: optMoney,
	minStayNights: optNights,
	maxStayNights: optNights
});

const promoCodeBaseSchema = z.object({
	code: z.string().min(2).max(MAX_PROMO_CODE_LENGTH),
	description: z.string().max(2000).optional(),
	discountType: z.enum(promoDiscountType.enumValues),
	/** Percent off (1–100), required when `discountType` is `percentage`. */
	discountPct: z.preprocess(blankToUndef, z.coerce.number().min(0.01).max(100).optional()),
	/** Flat ₱ off, required when `discountType` is `fixed_amount`. */
	discountAmountPhp: optMoney,
	validFrom: optUtcDateTime,
	validUntil: optUtcDateTime
});
function hasMatchingDiscountValue(d: z.infer<typeof promoCodeBaseSchema>): boolean {
	return d.discountType === 'percentage' ? d.discountPct != null : d.discountAmountPhp != null;
}
const createPromoCodeSchema = promoCodeBaseSchema.refine(hasMatchingDiscountValue, {
	message: 'Set a discount value matching the chosen type.'
});
const updatePromoCodeSchema = promoCodeBaseSchema
	.extend({ id: z.string().uuid(), isActive: z.coerce.boolean().optional() })
	.refine(hasMatchingDiscountValue, { message: 'Set a discount value matching the chosen type.' });

const toCentavos = (php: number | undefined) => (php != null ? Math.round(php * 100) : null);
const csvToArray = (csv: string | undefined) =>
	(csv ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);

export const actions: Actions = {
	createPolicy: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;

		const parsed = createPolicySchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success)
			return fail(400, { error: 'Check the cancellation policy and try again.' });

		const [row] = await db
			.insert(cancellationPolicies)
			.values({
				hotelId,
				name: parsed.data.name.trim(),
				description: parsed.data.description?.trim() || null,
				freeCancelHours: parsed.data.freeCancelHours ?? null,
				penaltyType: parsed.data.penaltyType,
				penaltyValueBps: parsed.data.penaltyValueBps ?? null,
				downpaymentBps: downpaymentBpsFrom(parsed.data.downpaymentPct)
			})
			.returning({ id: cancellationPolicies.id });

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'cancellation_policy.create',
			entityType: 'cancellation_policy',
			entityId: row!.id,
			after: parsed.data
		});

		return { ok: `Created policy "${parsed.data.name}".` };
	},

	updatePolicy: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;

		const raw = Object.fromEntries(await event.request.formData());
		const parsed = updatePolicySchema.safeParse(raw);
		if (!parsed.success)
			return fail(400, { error: 'Check the cancellation policy and try again.' });

		const [existing] = await db
			.select({ id: cancellationPolicies.id })
			.from(cancellationPolicies)
			.where(
				and(eq(cancellationPolicies.id, parsed.data.id), eq(cancellationPolicies.hotelId, hotelId))
			)
			.limit(1);
		if (!existing) return fail(404, { error: 'Policy not found.' });

		await db
			.update(cancellationPolicies)
			.set({
				name: parsed.data.name.trim(),
				description: parsed.data.description?.trim() || null,
				freeCancelHours: parsed.data.freeCancelHours ?? null,
				penaltyType: parsed.data.penaltyType,
				penaltyValueBps: parsed.data.penaltyValueBps ?? null,
				downpaymentBps: downpaymentBpsFrom(parsed.data.downpaymentPct)
			})
			.where(eq(cancellationPolicies.id, parsed.data.id));

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'cancellation_policy.update',
			entityType: 'cancellation_policy',
			entityId: parsed.data.id,
			after: parsed.data
		});

		return { ok: `Updated policy "${parsed.data.name}".` };
	},

	createSecurityDepositPolicy: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;

		const parsed = createDepositPolicySchema.safeParse(
			Object.fromEntries(await event.request.formData())
		);
		if (!parsed.success)
			return fail(400, { error: 'Check the security deposit policy and try again.' });

		const [row] = await db
			.insert(securityDepositPolicies)
			.values({
				hotelId,
				name: parsed.data.name.trim(),
				description: parsed.data.description?.trim() || null,
				amountCentavos: Math.round(parsed.data.amountPhp * 100)
			})
			.returning({ id: securityDepositPolicies.id });

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'security_deposit_policy.create',
			entityType: 'security_deposit_policy',
			entityId: row!.id,
			after: parsed.data
		});

		return { ok: `Created security deposit policy "${parsed.data.name}".` };
	},

	updateSecurityDepositPolicy: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;

		const raw = Object.fromEntries(await event.request.formData());
		const parsed = updateDepositPolicySchema.safeParse(raw);
		if (!parsed.success)
			return fail(400, { error: 'Check the security deposit policy and try again.' });

		const [existing] = await db
			.select({ id: securityDepositPolicies.id })
			.from(securityDepositPolicies)
			.where(
				and(
					eq(securityDepositPolicies.id, parsed.data.id),
					eq(securityDepositPolicies.hotelId, hotelId)
				)
			)
			.limit(1);
		if (!existing) return fail(404, { error: 'Policy not found.' });

		await db
			.update(securityDepositPolicies)
			.set({
				name: parsed.data.name.trim(),
				description: parsed.data.description?.trim() || null,
				amountCentavos: Math.round(parsed.data.amountPhp * 100)
			})
			.where(eq(securityDepositPolicies.id, parsed.data.id));

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'security_deposit_policy.update',
			entityType: 'security_deposit_policy',
			entityId: parsed.data.id,
			after: parsed.data
		});

		return { ok: `Updated security deposit policy "${parsed.data.name}".` };
	},

	createRatePlan: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;

		const raw = Object.fromEntries(await event.request.formData());
		const parsed = createPlanSchema.safeParse(raw);
		if (!parsed.success) return fail(400, { error: 'Check the rate plan details and try again.' });

		if (
			parsed.data.minStayNights != null &&
			parsed.data.maxStayNights != null &&
			parsed.data.maxStayNights < parsed.data.minStayNights
		) {
			return fail(400, { error: 'Max stay must be at least the min stay.' });
		}

		const [row] = await db
			.insert(ratePlans)
			.values({
				hotelId,
				roomTypeId: parsed.data.roomTypeId,
				cancellationPolicyId: parsed.data.cancellationPolicyId || null,
				securityDepositPolicyId: parsed.data.securityDepositPolicyId || null,
				name: parsed.data.name.trim(),
				description: parsed.data.description?.trim() || null,
				inclusions: csvToArray(parsed.data.inclusionsCsv),
				basePriceCentavos: Math.round(parsed.data.basePricePhp * 100),
				extraPersonFeeCentavos: toCentavos(parsed.data.extraPersonFeePhp),
				extraBedFeeCentavos: toCentavos(parsed.data.extraBedFeePhp),
				minStayNights: parsed.data.minStayNights ?? null,
				maxStayNights: parsed.data.maxStayNights ?? null
			})
			.returning({ id: ratePlans.id });

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'rate_plan.create',
			entityType: 'rate_plan',
			entityId: row!.id,
			after: parsed.data
		});

		return { ok: `Created rate plan "${parsed.data.name}".` };
	},

	createPromoCode: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;

		const parsed = createPromoCodeSchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Check the promo code details and try again.' });

		if (
			parsed.data.validFrom &&
			parsed.data.validUntil &&
			parsed.data.validUntil < parsed.data.validFrom
		) {
			return fail(400, { error: 'Valid-until must not be before valid-from.' });
		}

		const code = normalizePromoCode(parsed.data.code);
		try {
			const [row] = await db
				.insert(promoCodes)
				.values({
					hotelId,
					code,
					description: parsed.data.description?.trim() || null,
					discountType: parsed.data.discountType,
					discountBps:
						parsed.data.discountType === 'percentage'
							? Math.round(parsed.data.discountPct! * 100)
							: null,
					discountAmountCentavos:
						parsed.data.discountType === 'fixed_amount' ? toCentavos(parsed.data.discountAmountPhp) : null,
					validFrom: parsed.data.validFrom ?? null,
					validUntil: parsed.data.validUntil ?? null
				})
				.returning({ id: promoCodes.id });

			await writeAudit({
				hotelId,
				actor: event.locals.user,
				action: 'promo_code.create',
				entityType: 'promo_code',
				entityId: row!.id,
				after: { ...parsed.data, code }
			});
		} catch (e) {
			if (e instanceof Error && 'code' in e && (e as { code: string }).code === '23505') {
				return fail(400, { error: `Promo code "${code}" already exists.` });
			}
			throw e;
		}

		return { ok: `Created promo code "${code}".` };
	},

	updatePromoCode: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;

		const raw = Object.fromEntries(await event.request.formData());
		const parsed = updatePromoCodeSchema.safeParse({ ...raw, isActive: raw.isActive === 'on' });
		if (!parsed.success) return fail(400, { error: 'Check the promo code details and try again.' });

		if (
			parsed.data.validFrom &&
			parsed.data.validUntil &&
			parsed.data.validUntil < parsed.data.validFrom
		) {
			return fail(400, { error: 'Valid-until must not be before valid-from.' });
		}

		const [existing] = await db
			.select({ id: promoCodes.id })
			.from(promoCodes)
			.where(and(eq(promoCodes.id, parsed.data.id), eq(promoCodes.hotelId, hotelId)))
			.limit(1);
		if (!existing) return fail(404, { error: 'Promo code not found.' });

		const code = normalizePromoCode(parsed.data.code);
		try {
			await db
				.update(promoCodes)
				.set({
					code,
					description: parsed.data.description?.trim() || null,
					discountType: parsed.data.discountType,
					discountBps:
						parsed.data.discountType === 'percentage'
							? Math.round(parsed.data.discountPct! * 100)
							: null,
					discountAmountCentavos:
						parsed.data.discountType === 'fixed_amount' ? toCentavos(parsed.data.discountAmountPhp) : null,
					validFrom: parsed.data.validFrom ?? null,
					validUntil: parsed.data.validUntil ?? null,
					isActive: parsed.data.isActive ?? false,
					updatedAt: new Date()
				})
				.where(eq(promoCodes.id, parsed.data.id));

			await writeAudit({
				hotelId,
				actor: event.locals.user,
				action: 'promo_code.update',
				entityType: 'promo_code',
				entityId: parsed.data.id,
				after: { ...parsed.data, code }
			});
		} catch (e) {
			if (e instanceof Error && 'code' in e && (e as { code: string }).code === '23505') {
				return fail(400, { error: `Promo code "${code}" already exists.` });
			}
			throw e;
		}

		return { ok: `Updated promo code "${code}".` };
	}
};
