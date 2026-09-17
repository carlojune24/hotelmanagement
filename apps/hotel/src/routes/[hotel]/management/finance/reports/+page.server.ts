import { requireCap } from '$lib/server/auth/rbac';
import { REPORTS } from '$lib/server/finance/report-runner';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'reports:read');
	return { reports: REPORTS };
};
