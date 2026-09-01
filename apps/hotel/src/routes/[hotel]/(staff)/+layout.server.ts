import { redirect } from '@sveltejs/kit';
import { requireHotelRole } from '$lib/server/auth/rbac';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
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

	return {
		user: locals.user,
		hotel: locals.hotel,
		role: locals.role
	};
};
