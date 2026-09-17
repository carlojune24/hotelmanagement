import { redirect } from '@sveltejs/kit';
import { requireHotelRole, roleCan } from '$lib/server/auth/rbac';
import { countUnreadGuestMessages } from '$lib/server/guest-messages';
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
			unreadMessageCount: 0
		};
	}

	if (!locals.user) {
		redirect(302, `/${params.hotel}/management/login?next=${encodeURIComponent(url.pathname)}`);
	}

	// Any hotel role (or platform admin) may enter the staff shell; per-area
	// guards refine this in later phases.
	requireHotelRole(locals.user, locals.role);

	depends('app:guest-messages');
	const canSeeMessages =
		locals.user.isPlatformAdmin ||
		(locals.role ? roleCan(locals.role.capabilities, 'booking:read') : false);
	const unreadMessageCount = canSeeMessages ? await countUnreadGuestMessages(locals.hotel!.id) : 0;

	return {
		user: locals.user,
		hotel: locals.hotel,
		role: locals.role,
		unreadMessageCount
	};
};
