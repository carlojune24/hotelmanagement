import { requireCap } from '$lib/server/auth/rbac';
import type { PageServerLoad } from './$types';

/** Company-level copy of an establishment's DTR guide, for Main HR who run payroll off those DTRs. */
export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.access, 'payroll:*');
	return {};
};
