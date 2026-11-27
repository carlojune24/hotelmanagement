import { listRestocks } from '$lib/server/stock';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	// shortcut: newest 200 receipts, no paging; add paging once a hotel outgrows it.
	return { restocks: await listRestocks(locals.hotel!.id) };
};
