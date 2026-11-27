import { requireCap } from '$lib/server/auth/rbac';
import { roleCan } from '$lib/authz';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'inventory:read');
	const role = locals.role;
	const isAdmin = locals.user?.isPlatformAdmin ?? false;
	const can = (cap: string) => isAdmin || (role ? roleCan(role.capabilities, cap) : false);
	return { inventory: { canWrite: can('inventory:write'), canManage: can('inventory:manage') } };
};
