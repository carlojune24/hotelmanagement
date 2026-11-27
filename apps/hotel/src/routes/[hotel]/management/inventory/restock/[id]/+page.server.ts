import { error, fail } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { roleCan } from '$lib/authz';
import { FinanceError } from '$lib/server/finance/shared';
import { getRestock, StockError, voidRestock } from '$lib/server/stock';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const found = await getRestock(locals.hotel!.id, params.id);
	if (!found) error(404, 'Receipt not found');
	const can = (cap: string) => !!locals.user?.isPlatformAdmin || (!!locals.role && roleCan(locals.role.capabilities, cap));
	return { ...found, canSeeExpense: can('finance:read') };
};

export const actions: Actions = {
	void: async ({ locals, request, params }) => {
		requireCap(locals.user, locals.role, 'inventory:write');
		const reason = String((await request.formData()).get('reason') ?? '');
		try {
			await voidRestock(locals.hotel!.id, params.id, reason, locals.user);
		} catch (e) {
			if (e instanceof StockError || e instanceof FinanceError) return fail(400, { error: e.message });
			throw e;
		}
		return { ok: 'Receipt voided: its stock is taken back out and its expense is voided.' };
	}
};
