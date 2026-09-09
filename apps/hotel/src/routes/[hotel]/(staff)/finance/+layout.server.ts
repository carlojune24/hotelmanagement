import { requireCap } from '$lib/server/auth/rbac';
import { roleCan } from '$lib/authz';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	const role = locals.role;
	const isAdmin = locals.user?.isPlatformAdmin ?? false;
	const can = (cap: string) => isAdmin || (role ? roleCan(role, cap) : false);

	return {
		finance: {
			canWrite: can('finance:write'),
			canExpense: can('expense:create'),
			canReceivable: can('receivable:write'),
			canDayClose: can('dayclose:run'),
			canAdmin: can('hotel:admin'),
			canShift: can('shift:write')
		}
	};
};
