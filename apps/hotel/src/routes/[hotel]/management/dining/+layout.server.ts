import { roleCan } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'dining:read');
	const can = (cap: string) =>
		!!locals.user?.isPlatformAdmin || (!!locals.role && roleCan(locals.role.capabilities, cap));
	return {
		canManageMenu: can('dining:manage') || can('hotel:admin'),
		canEditSettings: can('hotel:admin')
	};
};
