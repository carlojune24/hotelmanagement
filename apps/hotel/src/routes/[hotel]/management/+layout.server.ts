import { redirect } from '@sveltejs/kit';
import { requireHotelRole, roleCan } from '$lib/server/auth/rbac';
import { countUnreadGuestMessages } from '$lib/server/guest-messages';
import { listOpenShiftAlerts, type OpenShiftAlert } from '$lib/server/finance/shifts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url, route, params, depends }) => {
	// The hotel-scoped login page lives inside this same route tree — it must never be
	// gated by the very guard it exists to satisfy, or an unauthenticated visitor could
	// never reach it (an infinite redirect back to itself).
	if (route.id === '/[hotel]/management/login') {
		return {
			user: locals.user,
			hotel: locals.hotel,
			role: locals.role,
			unreadMessageCount: 0,
			shiftAlerts: { mine: [] as OpenShiftAlert[], others: [] as OpenShiftAlert[] }
		};
	}

	if (!locals.user) {
		// On a hotel's custom domain `reroute` maps `/management/...` back to `/{slug}/management/...`
		// internally, so the redirect stays slug-free and the slug never shows in the URL bar.
		const prefix = locals.isCustomDomain ? '' : `/${params.hotel}`;
		redirect(302, `${prefix}/management/login?next=${encodeURIComponent(url.pathname)}`);
	}

	// Any hotel role (or platform admin) may enter the staff shell; per-area
	// guards refine this in later phases.
	requireHotelRole(locals.user, locals.role);

	depends('app:guest-messages');
	const canSeeMessages =
		locals.user.isPlatformAdmin ||
		(locals.role ? roleCan(locals.role.capabilities, 'booking:read') : false);
	const unreadMessageCount = canSeeMessages ? await countUnreadGuestMessages(locals.hotel!.id) : 0;

	// Open cashier shifts: your own always show (and block sign-out); other people's only to
	// someone who could close them on their behalf.
	depends('app:shift-alerts');
	const canManageShifts =
		locals.user.isPlatformAdmin ||
		(locals.role ? roleCan(locals.role.capabilities, 'shift:write') : false);
	const openShifts = await listOpenShiftAlerts(locals.hotel!.id);
	const shiftAlerts = {
		mine: openShifts.filter((s) => s.openedByUserId === locals.user!.id),
		others: canManageShifts ? openShifts.filter((s) => s.openedByUserId !== locals.user!.id) : []
	};

	return {
		user: locals.user,
		hotel: locals.hotel,
		role: locals.role,
		unreadMessageCount,
		shiftAlerts
	};
};
