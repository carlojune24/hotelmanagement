import { roleCan } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import { countAwaitingAcceptance } from '$lib/server/dining-orders';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, depends }) => {
	// Refreshed with the Orders board's own polling, so the tab badge stays current there.
	depends('app:dining-orders');
	requireCap(locals.user, locals.role, 'dining:read');
	const can = (cap: string) =>
		!!locals.user?.isPlatformAdmin || (!!locals.role && roleCan(locals.role.capabilities, cap));
	return {
		canManageMenu: can('dining:manage') || can('hotel:admin'),
		canEditSettings: can('hotel:admin'),
		/** Table-QR orders waiting for a waiter, shown as a badge on the Orders tab. */
		awaitingAcceptance: await countAwaitingAcceptance(locals.hotel!.id)
	};
};
