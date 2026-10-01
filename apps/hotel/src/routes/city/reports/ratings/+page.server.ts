import { requirePlatformAdmin } from '$lib/server/auth/rbac';
import { ratingsForRequest } from '$lib/server/city/ratings';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requirePlatformAdmin(locals.user);
	return ratingsForRequest(url.searchParams);
};
