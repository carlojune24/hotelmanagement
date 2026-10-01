import { requirePlatformAdmin } from '$lib/server/auth/rbac';
import { occupancyForRequest } from '$lib/server/city/occupancy';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requirePlatformAdmin(locals.user);
	return occupancyForRequest(url.searchParams);
};
