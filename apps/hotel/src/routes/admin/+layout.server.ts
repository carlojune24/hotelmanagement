import { requirePlatformAdmin } from '$lib/server/auth/rbac';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	requirePlatformAdmin(locals.user);
	return { user: locals.user };
};
