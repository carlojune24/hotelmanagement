import { error } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { getStatementOfAccount } from '$lib/server/finance/receivables';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	const statement = await getStatementOfAccount(locals.hotel!.id, params.receivableId);
	if (!statement) error(404, 'City-ledger account not found');
	return {
		statement,
		printedAt: new Date().toISOString().slice(0, 16).replace('T', ' ')
	};
};
