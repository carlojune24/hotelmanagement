import { requireUser } from '$lib/server/auth/rbac';
import { getOrganization } from '$lib/server/establishments';
import { canAnywhere } from '$lib/authz';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	requireUser(locals.user, url.pathname + url.search);
	const org = await getOrganization().catch(() => null);
	const access = locals.access!;
	return {
		user: { name: locals.user.name, email: locals.user.email },
		orgName: org?.name ?? 'HR',
		// Nav items show only for a user who holds the capability somewhere; never as disabled stubs.
		nav: {
			establishments: locals.user.isSystemAdmin || canAnywhere(access, 'establishment:read')
		}
	};
};
