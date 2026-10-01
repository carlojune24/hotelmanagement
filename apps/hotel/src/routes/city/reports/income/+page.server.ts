import { requirePlatformAdmin } from '$lib/server/auth/rbac';
import { incomeForRequest } from '$lib/server/city/income';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requirePlatformAdmin(locals.user);
	const { range, report } = await incomeForRequest(url.searchParams);
	return { range, report };
};
