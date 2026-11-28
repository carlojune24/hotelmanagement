import { businessDateFor } from '$lib/server/finance/shared';
import { stockForecast } from '$lib/server/stock-insights';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const hotel = locals.hotel!;
	const today = businessDateFor(hotel.timezone);
	const toOrder = (await stockForecast(hotel.id, hotel.timezone, today)).filter((r) => r.needsOrder);
	return { today, toOrder };
};
