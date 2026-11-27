import { listMovements, listStock } from '$lib/server/stock';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const hotelId = locals.hotel!.id;
	const items = (await listStock(hotelId)).map((r) => ({ id: r.id, name: r.name }));
	const requested = url.searchParams.get('item');
	const itemId = items.some((i) => i.id === requested) ? requested! : null;
	return {
		items,
		itemId,
		timezone: locals.hotel!.timezone,
		// shortcut: newest 300 only, no paging; add paging once a hotel's ledger outgrows it.
		movements: await listMovements(hotelId, { itemId: itemId ?? undefined, limit: 300 })
	};
};
