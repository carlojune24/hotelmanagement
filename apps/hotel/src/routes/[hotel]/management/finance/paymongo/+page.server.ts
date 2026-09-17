import { requireCap } from '$lib/server/auth/rbac';
import { listPaymongoTransactions } from '$lib/server/finance/paymongo-transactions';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'finance:read');

	const statusParam = url.searchParams.get('status');
	const status =
		statusParam === 'pending' || statusParam === 'paid' || statusParam === 'failed'
			? statusParam
			: undefined;
	const purposeParam = url.searchParams.get('type');
	const purpose =
		purposeParam === 'settlement' || purposeParam === 'refund' ? purposeParam : undefined;

	const transactions = await listPaymongoTransactions(locals.hotel!.id, { status, purpose });

	return {
		transactions,
		status: status ?? 'all',
		purpose: purpose ?? 'all'
	};
};
