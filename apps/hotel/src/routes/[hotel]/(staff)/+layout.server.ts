import { redirect } from '@sveltejs/kit';
import { requireHotelRole, roleCan } from '$lib/server/auth/rbac';
import { countUnreadGuestMessages } from '$lib/server/guest-messages';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url, depends }) => {
	if (!locals.user) redirect(302, `/auth/login?next=${encodeURIComponent(url.pathname)}`);

	// Any hotel role (or platform admin) may enter the staff shell; per-area
	// guards refine this in later phases.
	requireHotelRole(locals.user, locals.role, [
		'hotel_admin',
		'front_desk',
		'housekeeping',
		'accountant',
		'hr',
		'read_only'
	]);

	depends('app:guest-messages');
	const canSeeMessages =
		locals.user.isPlatformAdmin || (locals.role ? roleCan(locals.role, 'booking:read') : false);
	const unreadMessageCount = canSeeMessages ? await countUnreadGuestMessages(locals.hotel!.id) : 0;

	return {
		user: locals.user,
		hotel: locals.hotel,
		role: locals.role,
		unreadMessageCount
	};
};
