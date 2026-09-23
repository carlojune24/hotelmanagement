import { requireCap } from '$lib/server/auth/rbac';
import { listReservationPage } from '$lib/server/reservations';
import { todayInTimezone } from '$lib/server/front-desk';
import { RESERVATIONS_PAGE_SIZE, parseReservationParams } from '$lib/reservation-views';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'booking:read');
	const hotel = locals.hotel!;
	const params = parseReservationParams(url.searchParams);
	const { lines, total, counts } = await listReservationPage(hotel.id, params);
	return {
		lines,
		total,
		counts,
		params,
		pageSize: RESERVATIONS_PAGE_SIZE,
		today: todayInTimezone(hotel.timezone)
	};
};
