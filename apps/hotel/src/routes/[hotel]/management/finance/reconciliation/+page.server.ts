import { requireCap } from '$lib/server/auth/rbac';
import { getPaymentReconciliation, parseReconciliationFilter } from '$lib/server/finance/payment-reconciliation';
import type { PageServerLoad } from './$types';

/**
 * Finance → Reconciliation: payments PayMongo took that the webhook never told us about and the system settled by
 * asking PayMongo itself, plus anything still unresolved. See `finance/payment-reconciliation.ts`.
 */
export const load: PageServerLoad = async ({ locals, url, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	requireCap(locals.user, locals.role, 'finance:read');
	const hotel = locals.hotel!;
	const filter = parseReconciliationFilter(url);
	const recon = await getPaymentReconciliation(hotel.id, hotel.timezone, filter);
	return { timezone: hotel.timezone, filter, ...recon };
};
