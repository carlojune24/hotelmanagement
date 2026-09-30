import { error, fail } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import {
	cancellationPolicies,
	dailyRates,
	ratePlans,
	securityDepositPolicies,
	seasonalRates
} from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import {
	RatePlanScopeError,
	assertPlanRefsInHotel,
	assertRatePlanInHotel,
	listDistinctInclusions
} from '$lib/server/rate-plans';
import { friendlyIssue, moneyPhp, optMoneyPhp, recordId } from '$lib/rate-validation';
import type { Actions, PageServerLoad } from './$types';

const toCentavos = (php: number | undefined) => (php != null ? Math.round(php * 100) : null);
const csvToArray = (csv: string | undefined) =>
	(csv ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);

/** Empty form fields post `""`; treat that (and null) as "not provided" before coercion. */
const blankToUndef = (v: unknown) => (v === '' || v == null ? undefined : v);
const optMoney = optMoneyPhp;
const optNights = z.preprocess(blankToUndef, z.coerce.number().int().min(1).max(365).optional());

export const load: PageServerLoad = async ({ locals, params }) => {
	requireCap(locals.user, locals.role, 'hotel:admin');
	const hotelId = locals.hotel!.id;

	const [plan] = await db
		.select()
		.from(ratePlans)
		.where(and(eq(ratePlans.id, params.ratePlanId), eq(ratePlans.hotelId, hotelId)))
		.limit(1);
	if (!plan) error(404, 'Rate plan not found');

	const overrides = await db
		.select()
		.from(dailyRates)
		.where(and(eq(dailyRates.ratePlanId, params.ratePlanId), eq(dailyRates.hotelId, hotelId)))
		.orderBy(asc(dailyRates.date));

	const seasons = await db
		.select()
		.from(seasonalRates)
		.where(and(eq(seasonalRates.ratePlanId, params.ratePlanId), eq(seasonalRates.hotelId, hotelId)))
		.orderBy(asc(seasonalRates.startDate));

	const policies = await db
		.select({ id: cancellationPolicies.id, name: cancellationPolicies.name })
		.from(cancellationPolicies)
		.where(eq(cancellationPolicies.hotelId, hotelId))
		.orderBy(asc(cancellationPolicies.name));

	const depositPolicies = await db
		.select({
			id: securityDepositPolicies.id,
			name: securityDepositPolicies.name,
			amountCentavos: securityDepositPolicies.amountCentavos
		})
		.from(securityDepositPolicies)
		.where(eq(securityDepositPolicies.hotelId, hotelId))
		.orderBy(asc(securityDepositPolicies.name));

	const inclusionSuggestions = await listDistinctInclusions(hotelId);

	return {
		ratePlan: plan,
		overrides,
		seasons,
		cancellationPolicies: policies,
		securityDepositPolicies: depositPolicies,
		inclusionSuggestions
	};
};

const updateSchema = z.object({
	name: z.string().min(2).max(120),
	description: z.string().max(2000).optional(),
	inclusionsCsv: z.string().max(500).optional(),
	basePricePhp: moneyPhp(),
	weekendPricePhp: optMoney,
	extraPersonFeePhp: optMoney,
	extraChildFeePhp: optMoney,
	childFreeMaxAge: z.preprocess(blankToUndef, z.coerce.number().int().min(0).max(17).optional()),
	extraBedFeePhp: optMoney,
	minStayNights: optNights,
	maxStayNights: optNights,
	cancellationPolicyId: z.string().uuid().optional(),
	securityDepositPolicyId: z.string().uuid().optional(),
	isActive: z.coerce.boolean().optional()
});

const overrideSchema = z.object({
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	pricePhp: moneyPhp(),
	minStayNights: optNights
});

const seasonSchema = z
	.object({
		name: z.string().min(2).max(120),
		startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
		endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
		pricePhp: optMoney,
		multiplierPct: z.preprocess(blankToUndef, z.coerce.number().min(1).max(1000).optional()),
		minStayNights: optNights
	})
	.refine((d) => d.endDate >= d.startDate, { message: 'End date must not be before start date.' })
	.refine((d) => d.pricePhp != null || d.multiplierPct != null, {
		message: 'Set either a fixed price or a multiplier.'
	});

/** RATES-001: these actions take the rate plan id from the URL and can be POSTed to directly,
 *  so each one confirms the plan is this hotel's before writing anything. Returns a ready
 *  `fail(404)` for the action to return, or null when the plan is the caller's. */
async function planScopeFailure(hotelId: string, ratePlanId: string) {
	try {
		await assertRatePlanInHotel(hotelId, ratePlanId);
		return null;
	} catch (e) {
		if (e instanceof RatePlanScopeError) return fail(404, { error: e.message });
		throw e;
	}
}

export const actions: Actions = {
	update: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;
		const ratePlanId = event.params.ratePlanId;

		const form = await event.request.formData();
		const raw = Object.fromEntries(form);
		const scopeFailure = await planScopeFailure(hotelId, ratePlanId);
		if (scopeFailure) return scopeFailure;

		const parsed = updateSchema.safeParse({ ...raw, isActive: raw.isActive === 'on' });
		if (!parsed.success)
			return fail(400, {
				error: friendlyIssue(parsed.error, 'Check the rate plan details and try again.')
			});

		// RATES-003: the policies this plan is pointed at must be this hotel's own.
		try {
			await assertPlanRefsInHotel(hotelId, {
				cancellationPolicyId: parsed.data.cancellationPolicyId,
				securityDepositPolicyId: parsed.data.securityDepositPolicyId
			});
		} catch (e) {
			if (e instanceof RatePlanScopeError) return fail(400, { error: e.message });
			throw e;
		}

		if (
			parsed.data.minStayNights != null &&
			parsed.data.maxStayNights != null &&
			parsed.data.maxStayNights < parsed.data.minStayNights
		) {
			return fail(400, { error: 'Max stay must be at least the min stay.' });
		}

		// Weekend days arrive as repeated `weekendDay` checkbox values (0 = Sun … 6 = Sat).
		const weekendDays = [...new Set(form.getAll('weekendDay').map((v) => Number(v)))]
			.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
			.sort((a, b) => a - b);

		const updated = await db
			.update(ratePlans)
			.set({
				name: parsed.data.name.trim(),
				description: parsed.data.description?.trim() || null,
				inclusions: csvToArray(parsed.data.inclusionsCsv),
				basePriceCentavos: Math.round(parsed.data.basePricePhp * 100),
				weekendPriceCentavos: toCentavos(parsed.data.weekendPricePhp),
				weekendDays,
				extraPersonFeeCentavos: toCentavos(parsed.data.extraPersonFeePhp),
				extraChildFeeCentavos: toCentavos(parsed.data.extraChildFeePhp),
				childFreeMaxAge: parsed.data.childFreeMaxAge ?? null,
				extraBedFeeCentavos: toCentavos(parsed.data.extraBedFeePhp),
				minStayNights: parsed.data.minStayNights ?? null,
				maxStayNights: parsed.data.maxStayNights ?? null,
				cancellationPolicyId: parsed.data.cancellationPolicyId || null,
				securityDepositPolicyId: parsed.data.securityDepositPolicyId || null,
				isActive: parsed.data.isActive ?? false,
				updatedAt: new Date()
			})
			.where(and(eq(ratePlans.id, ratePlanId), eq(ratePlans.hotelId, hotelId)))
			.returning({ id: ratePlans.id });
		// RATES-007: nothing matched → don't claim success or write a misleading audit entry.
		if (updated.length === 0) return fail(404, { error: 'Rate plan not found.' });

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'rate_plan.update',
			entityType: 'rate_plan',
			entityId: ratePlanId,
			after: parsed.data
		});

		return { ok: 'Rate plan updated.' };
	},

	addOverride: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;
		const ratePlanId = event.params.ratePlanId;

		const scopeFailure = await planScopeFailure(hotelId, ratePlanId);
		if (scopeFailure) return scopeFailure;

		const parsed = overrideSchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success)
			return fail(400, {
				error: friendlyIssue(parsed.error, 'Check the date and price and try again.')
			});

		await db
			.insert(dailyRates)
			.values({
				hotelId,
				ratePlanId,
				date: parsed.data.date,
				priceCentavos: Math.round(parsed.data.pricePhp * 100),
				minStayNights: parsed.data.minStayNights ?? null
			})
			.onConflictDoUpdate({
				target: [dailyRates.ratePlanId, dailyRates.date],
				set: {
					priceCentavos: Math.round(parsed.data.pricePhp * 100),
					minStayNights: parsed.data.minStayNights ?? null,
					updatedAt: new Date()
				}
			});

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'daily_rate.set',
			entityType: 'daily_rate',
			entityId: `${ratePlanId}:${parsed.data.date}`,
			after: parsed.data
		});

		return { ok: `Set price override for ${parsed.data.date}.` };
	},

	removeOverride: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;

		const data = await event.request.formData();
		const id = String(data.get('id') ?? '');
		if (!recordId().safeParse(id).success) return fail(400, { error: 'Missing override.' });

		const removed = await db
			.delete(dailyRates)
			.where(and(eq(dailyRates.id, id), eq(dailyRates.hotelId, hotelId)))
			.returning({ id: dailyRates.id });
		// Nothing deleted (already gone, or not this hotel's row) → say so, don't claim "removed".
		if (removed.length === 0) return fail(404, { error: 'Override not found.' });

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'daily_rate.remove',
			entityType: 'daily_rate',
			entityId: id
		});

		return { ok: 'Override removed.' };
	},

	addSeason: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;
		const ratePlanId = event.params.ratePlanId;

		const scopeFailure = await planScopeFailure(hotelId, ratePlanId);
		if (scopeFailure) return scopeFailure;

		const parsed = seasonSchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? 'Check the seasonal range and try again.'
			});
		}

		const [row] = await db
			.insert(seasonalRates)
			.values({
				hotelId,
				ratePlanId,
				name: parsed.data.name.trim(),
				startDate: parsed.data.startDate,
				endDate: parsed.data.endDate,
				priceCentavos: toCentavos(parsed.data.pricePhp),
				multiplierBps:
					parsed.data.multiplierPct != null ? Math.round(parsed.data.multiplierPct * 100) : null,
				minStayNights: parsed.data.minStayNights ?? null
			})
			.returning({ id: seasonalRates.id });

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'seasonal_rate.create',
			entityType: 'seasonal_rate',
			entityId: row!.id,
			after: parsed.data
		});

		return { ok: `Added seasonal range "${parsed.data.name}".` };
	},

	removeSeason: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;

		const id = String((await event.request.formData()).get('id') ?? '');
		if (!recordId().safeParse(id).success)
			return fail(400, { error: 'Missing seasonal range.' });

		const removed = await db
			.delete(seasonalRates)
			.where(and(eq(seasonalRates.id, id), eq(seasonalRates.hotelId, hotelId)))
			.returning({ id: seasonalRates.id });
		if (removed.length === 0) return fail(404, { error: 'Seasonal range not found.' });

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'seasonal_rate.remove',
			entityType: 'seasonal_rate',
			entityId: id
		});

		return { ok: 'Seasonal range removed.' };
	}
};
