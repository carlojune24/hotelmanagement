import { error } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { getBillForCheck } from '$lib/server/dining-bill';
import type { PageServerLoad } from './$types';

/** The guest's bill for a whole table. Staff only, never a guest link; prints nothing official and uses no serial. */
export const load: PageServerLoad = async ({ locals, params }) => {
	requireCap(locals.user, locals.role, 'dining:read');
	const bill = await getBillForCheck(locals.hotel!.id, params.checkId);
	if (!bill) error(404, 'Table check not found');
	return { bill };
};
