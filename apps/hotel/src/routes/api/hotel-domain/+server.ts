import { json } from '@sveltejs/kit';
import { loadHotelSlugByDomain } from '$lib/server/tenant';
import type { RequestHandler } from './$types';

/** hostname -> hotel slug, for the universal `reroute` hook in `src/hooks.ts` (which can't query the DB itself). */
export const GET: RequestHandler = async ({ url }) => {
	const host = url.searchParams.get('host')?.toLowerCase() ?? '';
	return json({ slug: host ? await loadHotelSlugByDomain(host) : null }, { headers: { 'cache-control': 'no-store' } });
};
