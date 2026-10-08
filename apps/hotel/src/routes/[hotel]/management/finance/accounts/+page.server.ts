import { requireCap } from '$lib/server/auth/rbac';
import { listAccountsOverview } from '$lib/server/finance/accounts-overview';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	return { accounts: await listAccountsOverview(locals.hotel!.id) };
};
