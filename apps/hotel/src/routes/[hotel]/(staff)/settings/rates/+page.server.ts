import { fail } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import {
	cancellationPenaltyType,
	cancellationPolicies,
	ratePlans,
	roomTypes
} from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
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

	const plans = await db
		.select({
			id: ratePlans.id,
			name: ratePlans.name,
			roomTypeId: ratePlans.roomTypeId,
			cancellationPolicyId: ratePlans.cancellationPolicyId,
			basePriceCentavos: ratePlans.basePriceCentavos,
			promoCode: ratePlans.promoCode,
			isActive: ratePlans.isActive
		})
		.from(ratePlans)
		.where(eq(ratePlans.hotelId, hotelId))
		.orderBy(asc(ratePlans.name));
	const roomTypeName = new Map(types.map((t) => [t.id, t.name]));
	const policyName = new Map(policies.map((c) => [c.id, c.name]));

	return {
		roomTypes: types,
		cancellationPolicies: policies,
		ratePlans: plans.map((p) => ({
			...p,
			roomTypeName: roomTypeName.get(p.roomTypeId) ?? '—',
			cancellationPolicyName: p.cancellationPolicyId
				? (policyName.get(p.cancellationPolicyId) ?? '—')
				: null
		}))
	};
};

const createPolicySchema = z.object({
	name: z.string().min(2).max(120),
	description: z.string().max(2000).optional(),
	freeCancelHours: z.coerce.number().int().min(0).max(8760).optional(),
	penaltyType: z.enum(cancellationPenaltyType.enumValues),
	penaltyValueBps: z.coerce.number().int().min(0).max(10000).optional()
});

/** Empty form fields post `""`; treat that (and null) as "not provided" before coercion. */
const blankToUndef = (v: unknown) => (v === '' || v == null ? undefined : v);
const optMoney = z.preprocess(blankToUndef, z.coerce.number().min(0).optional());
const optNights = z.preprocess(blankToUndef, z.coerce.number().int().min(1).max(365).optional());

const createPlanSchema = z.object({
	roomTypeId: z.string().uuid(),
	cancellationPolicyId: z.string().uuid().optional(),
	name: z.string().min(2).max(120),
	description: z.string().max(2000).optional(),
	inclusionsCsv: z.string().max(500).optional(),
	basePricePhp: z.coerce.number().min(0),
	extraPersonFeePhp: optMoney,
	extraBedFeePhp: optMoney,
	depositPhp: optMoney,
	minStayNights: optNights,
	maxStayNights: optNights,
	promoCode: z.string().max(40).optional()
});

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
				penaltyValueBps: parsed.data.penaltyValueBps ?? null
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
				name: parsed.data.name.trim(),
				description: parsed.data.description?.trim() || null,
				inclusions: csvToArray(parsed.data.inclusionsCsv),
				basePriceCentavos: Math.round(parsed.data.basePricePhp * 100),
				extraPersonFeeCentavos: toCentavos(parsed.data.extraPersonFeePhp),
				extraBedFeeCentavos: toCentavos(parsed.data.extraBedFeePhp),
				depositCentavos: toCentavos(parsed.data.depositPhp),
				minStayNights: parsed.data.minStayNights ?? null,
				maxStayNights: parsed.data.maxStayNights ?? null,
				promoCode: parsed.data.promoCode?.trim() || null
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
	}
};
