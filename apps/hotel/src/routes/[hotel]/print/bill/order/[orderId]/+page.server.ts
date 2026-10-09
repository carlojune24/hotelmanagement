import { error } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { getBillForOrder } from '$lib/server/dining-bill';
import type { PageServerLoad } from './$types';

/** The guest's bill for one order (a takeaway or an order with no table). Staff only; no serial. */
export const load: PageServerLoad = async ({ locals, params }) => {
	requireCap(locals.user, locals.role, 'dining:read');
	const bill = await getBillForOrder(locals.hotel!.id, params.orderId);
	if (!bill) error(404, 'Order not found');
	return { bill };
};
