import { requireUser } from '$lib/server/auth/rbac';
import { getOrganization } from '$lib/server/establishments';
import { logoUrlFor } from '$lib/server/brand';
import { canAnywhere, roleCan } from '$lib/authz';
import { pendingApprovalCount } from '$lib/server/hr/approvals';
import { establishmentScope } from '$lib/server/scope';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	requireUser(locals.user, url.pathname + url.search);
	const org = await getOrganization().catch(() => null);
	const access = locals.access!;
	const scope = await establishmentScope(locals.user, access, locals.establishment?.slug ?? null);
	const approver = locals.user.isSystemAdmin || roleCan(access.orgCaps, 'approval:*');
	return {
		user: { name: locals.user.name, email: locals.user.email },
		orgName: org?.name ?? 'HR',
		logoUrl: logoUrlFor(org?.config),
		/** Set for a manager or clerk: the sidebar becomes their establishment's menu. Null for Main HR. */
		scope,
		/** Waiting decisions, for the sidebar badge — only computed for someone who can decide them. */
		pendingApprovals: approver ? await pendingApprovalCount() : 0,
		// Nav items show only for a user who holds the capability somewhere; never as disabled stubs.
		nav: {
			establishments: locals.user.isSystemAdmin || canAnywhere(access, 'establishment:read'),
			people: locals.user.isSystemAdmin || roleCan(access.orgCaps, 'employee:read'),
			approvals: approver,
			payroll: locals.user.isSystemAdmin || roleCan(access.orgCaps, 'payroll:*'),
			// Filed by whoever runs payroll, but a section of its own.
			announcements: locals.user.isSystemAdmin || roleCan(access.orgCaps, 'announcement:*'),
			remittances: locals.user.isSystemAdmin || roleCan(access.orgCaps, 'payroll:*'),
			loans: locals.user.isSystemAdmin || roleCan(access.orgCaps, 'payroll:*'),
			separations: locals.user.isSystemAdmin || roleCan(access.orgCaps, 'payroll:*'),
			bonuses: locals.user.isSystemAdmin || roleCan(access.orgCaps, 'payroll:*'),
			payItems: locals.user.isSystemAdmin || roleCan(access.orgCaps, 'payroll:*'),
			reports: locals.user.isSystemAdmin || roleCan(access.orgCaps, 'payroll:*'),
			settings: locals.user.isSystemAdmin || roleCan(access.orgCaps, 'payroll:*'),
			users: locals.user.isSystemAdmin || roleCan(access.orgCaps, 'user:*')
		}
	};
};
