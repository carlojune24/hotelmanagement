import { error } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { getShiftReconciliation } from '$lib/server/finance/shifts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	const recon = await getShiftReconciliation(locals.hotel!.id, params.shiftId);
	if (!recon) error(404, 'Shift not found');
	return { recon };
};
