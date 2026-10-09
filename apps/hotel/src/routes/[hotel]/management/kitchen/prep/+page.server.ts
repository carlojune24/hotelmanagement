import { requireCap } from '$lib/server/auth/rbac';
import { listStations } from '$lib/server/dining-menu';
import { listBoardOrders } from '$lib/server/dining-orders';
import { buildPrepList } from '$lib/kitchen';
import type { PageServerLoad } from './$types';

/** Everything still to be cooked, added up across open tickets. Read-only: starting a dish is the Board's job. */
export const load: PageServerLoad = async ({ locals, depends }) => {
	depends('app:kitchen-prep');
	requireCap(locals.user, locals.role, 'kitchen:read');
	const hotelId = locals.hotel!.id;
	const [orders, stations] = await Promise.all([
		listBoardOrders(hotelId, { servedSince: new Date(Date.now() + 86_400_000) }),
		listStations(hotelId)
	]);
	return { prep: buildPrepList(orders, stations.map((s) => s.name)), serverNow: Date.now() };
};
