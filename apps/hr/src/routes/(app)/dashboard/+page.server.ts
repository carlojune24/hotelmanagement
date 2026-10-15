import { requireCap } from '$lib/server/auth/rbac';
import { roleCan } from '$lib/authz';
import { getOrganization } from '$lib/server/establishments';
import { getCompanyDashboard } from '$lib/server/hr/company-dashboard';
import { businessDateFor } from '$lib/server/time';
import type { PageServerLoad } from './$types';

/** The company-wide overview for Main HR: what needs attention, where the cutoff stands, what is coming. */
export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.access, 'payroll:*');
	const org = await getOrganization();
	const approver = !!locals.user?.isSystemAdmin || roleCan(locals.access!.orgCaps, 'approval:*');
	const today = businessDateFor('Asia/Manila');
	return { orgName: org.name, dashboard: await getCompanyDashboard(org.id, today, { approver }) };
};
