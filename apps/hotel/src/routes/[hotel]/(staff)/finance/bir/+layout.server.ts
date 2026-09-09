import { requireCap } from '$lib/server/auth/rbac';
import { roleCan } from '$lib/authz';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	const isAdmin = locals.user?.isPlatformAdmin ?? false;
	const can = (cap: string) => isAdmin || (locals.role ? roleCan(locals.role, cap) : false);
	return { bir: { canAdmin: can('hotel:admin'), canWrite: can('finance:write') } };
};
