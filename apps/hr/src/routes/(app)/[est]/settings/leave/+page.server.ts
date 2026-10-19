import { canAt } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import { listLeaveTypes } from '$lib/server/hr/leave';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	// Anyone who can see the establishment may read the leave rules; only Main HR (leave:*) changes them.
	requireCap(locals.user, locals.access, 'establishment:read', locals.establishment!.id);
	const establishment = locals.establishment!;
	const canEdit = locals.user!.isSystemAdmin || canAt(locals.access!, 'leave:*', establishment.id);
	const types = await listLeaveTypes(establishment.id);
	return {
		canEdit,
		/** Leave types are company-wide; the right to change them is Main HR's, whichever establishment is open. */
		canEditTypes: canEdit,
		types: types.map((t) => ({
			id: t.id,
			code: t.code,
			name: t.name,
			description: t.description ?? '',
			statutory: t.statutory,
			paid: t.paid,
			daysPerYear: t.daysPerYear,
			dayCount: t.dayCount as 'working' | 'calendar',
			minServiceMonths: t.minServiceMonths,
			employmentTypes: t.employmentTypes,
			sexRestriction: t.sexRestriction as 'male' | 'female' | null,
			halfDayAllowed: t.halfDayAllowed,
			carryOverDays: t.carryOverDays,
			cashConvertible: t.cashConvertible,
			requiresDocument: t.requiresDocument,
			active: t.active
		}))
	};
};
