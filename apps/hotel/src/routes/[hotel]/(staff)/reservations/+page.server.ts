import { requireCap } from '$lib/server/auth/rbac';
import { listReservationLines } from '$lib/server/reservations';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'booking:read');
	const lines = await listReservationLines(locals.hotel!.id);
	return { lines };
};
