import { requireCap } from '$lib/server/auth/rbac';
import { addDays } from '$lib/finance-range';
import { businessDateFor } from '$lib/server/finance/shared';
import { kitchenHistory } from '$lib/server/kitchen';
import type { PageServerLoad } from './$types';

const RANGES = { today: 0, '7d': 6, '30d': 29 } as const;

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'kitchen:read');
	const hotel = locals.hotel!;
	const asked = url.searchParams.get('range');
	const range = asked && asked in RANGES ? (asked as keyof typeof RANGES) : 'today';
	const today = businessDateFor(hotel.timezone);
	const history = await kitchenHistory(hotel, addDays(today, -RANGES[range]), today);
	return { range, history };
};
