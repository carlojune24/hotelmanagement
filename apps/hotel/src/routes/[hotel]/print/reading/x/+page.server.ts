import { requireCap } from '$lib/server/auth/rbac';
import { businessDateFor } from '$lib/server/finance/shared';
import { getXReading } from '$lib/server/finance/readings';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	const hotel = locals.hotel!;
	const date = url.searchParams.get('date') || businessDateFor(hotel.timezone);
	const reading = await getXReading(hotel.id, date);
	return {
		reading,
		printedAt: new Date().toISOString().slice(0, 16).replace('T', ' ')
	};
};
