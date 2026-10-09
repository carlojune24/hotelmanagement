import { roleCan } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'kitchen:read');
	const can = (cap: string) =>
		!!locals.user?.isPlatformAdmin || (!!locals.role && roleCan(locals.role.capabilities, cap));
	return {
		/** Station setup. */
		canManage: can('kitchen:manage') || can('hotel:admin'),
		/** Start/Ready and sold-out toggles. */
		canWrite: can('kitchen:write')
	};
};
