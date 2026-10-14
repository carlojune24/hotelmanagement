import { requireCap } from '$lib/server/auth/rbac';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.access, 'payroll:*');
	return {};
};
