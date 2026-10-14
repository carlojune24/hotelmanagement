import { error } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { getOrganization } from '$lib/server/establishments';
import { BonusError, getBatchView } from '$lib/server/hr/bonuses';
import { bonusActions } from '$lib/server/hr/bonus-actions';
import type { Actions, PageServerLoad } from './$types';

export const actions: Actions = bonusActions;

export const load: PageServerLoad = async ({ locals, params }) => {
	requireCap(locals.user, locals.access, 'payroll:*');
	const org = await getOrganization();
	try {
		return { batch: await getBatchView(org.id, params.batchId) };
	} catch (e) {
		if (e instanceof BonusError) error(404, 'Not found');
		throw e;
	}
};
