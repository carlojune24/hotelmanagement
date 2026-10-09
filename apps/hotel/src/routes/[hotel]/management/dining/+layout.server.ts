import { roleCan } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import { listServiceAlerts } from '$lib/server/dining-orders';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, depends }) => {
	// Refreshed with the Orders board's own polling, and by the layout's own alert poll, so the
	// tab badges stay current on every Dining tab.
	depends('app:dining-orders');
	depends('app:dining-alerts');
	requireCap(locals.user, locals.role, 'dining:read');
	const can = (cap: string) =>
		!!locals.user?.isPlatformAdmin || (!!locals.role && roleCan(locals.role.capabilities, cap));
	const alerts = await listServiceAlerts(locals.hotel!.id);
	return {
		canManageMenu: can('dining:manage') || can('hotel:admin'),
		canEditSettings: can('hotel:admin'),
		/** Table-QR orders waiting for a waiter, shown as a badge on the Orders tab. */
		awaitingAcceptance: alerts.qrWaiting.length,
		/** Food the kitchen has finished and nobody has served yet, and QR orders to accept. */
		alerts
	};
};
