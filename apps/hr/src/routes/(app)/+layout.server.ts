import { requireUser } from '$lib/server/auth/rbac';
import { getOrganization } from '$lib/server/establishments';
import { canAnywhere, roleCan } from '$lib/authz';
import { pendingApprovalCount } from '$lib/server/hr/approvals';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	requireUser(locals.user, url.pathname + url.search);
	const org = await getOrganization().catch(() => null);
	const access = locals.access!;
	const approver = locals.user.isSystemAdmin || roleCan(access.orgCaps, 'approval:*');
	return {
		user: { name: locals.user.name, email: locals.user.email },
		orgName: org?.name ?? 'HR',
		/** Waiting decisions, for the sidebar badge — only computed for someone who can decide them. */
		pendingApprovals: approver ? await pendingApprovalCount() : 0,
		// Nav items show only for a user who holds the capability somewhere; never as disabled stubs.
		nav: {
			establishments: locals.user.isSystemAdmin || canAnywhere(access, 'establishment:read'),
			people: locals.user.isSystemAdmin || roleCan(access.orgCaps, 'employee:read'),
			approvals: approver,
			payroll: locals.user.isSystemAdmin || roleCan(access.orgCaps, 'payroll:*'),
			// Filed by whoever runs payroll, but a section of its own.
			remittances: locals.user.isSystemAdmin || roleCan(access.orgCaps, 'payroll:*'),
			users: locals.user.isSystemAdmin || roleCan(access.orgCaps, 'user:*')
		}
	};
};
