import { requirePlatformAdmin } from '$lib/server/auth/rbac';
import { visitorsForRequest } from '$lib/server/city/visitors';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requirePlatformAdmin(locals.user);
	const { range, report } = await visitorsForRequest(url.searchParams);
	return { range, report };
};
