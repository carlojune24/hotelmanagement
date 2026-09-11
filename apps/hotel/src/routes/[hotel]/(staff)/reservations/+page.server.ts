import { requireCap } from '$lib/server/auth/rbac';
import { listReservationLines } from '$lib/server/reservations';
import { todayInTimezone } from '$lib/server/front-desk';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'booking:read');
	const hotel = locals.hotel!;
	const lines = await listReservationLines(hotel.id);
	return { lines, today: todayInTimezone(hotel.timezone) };
};
