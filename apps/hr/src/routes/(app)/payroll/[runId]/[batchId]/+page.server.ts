import { error } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { PayrollError } from '$lib/server/hr/payroll';
import { runView } from '$lib/server/hr/payroll-view';
import type { PageServerLoad } from './$types';

/** One establishment's batch, focused. The actions are the run page's, so the two always behave alike. */
export { actions } from '../+page.server';

export const load: PageServerLoad = async ({ locals, params }) => {
	requireCap(locals.user, locals.access, 'payroll:*');
	let view;
	try {
		view = await runView(params.runId);
	} catch (e) {
		if (e instanceof PayrollError) error(404, 'Payroll run not found');
		throw e;
	}
	const batch = view.batches.find((b) => b.id === params.batchId);
	if (!batch) error(404, 'That establishment is not part of this payroll run');
	return { run: view.run, batch };
};
