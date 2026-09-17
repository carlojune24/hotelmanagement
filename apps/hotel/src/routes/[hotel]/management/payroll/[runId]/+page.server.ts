import { error, fail } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { getPayrollRun, getPayrollRunLines, generatePayrollRunLines } from '$lib/server/hr/payroll';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	requireCap(locals.user, locals.role, 'payroll:*');
	const hotelId = locals.hotel!.id;

	const run = await getPayrollRun(hotelId, params.runId);
	if (!run) error(404, 'Payroll run not found');

	const lines = await getPayrollRunLines(run.id);
	return { run, lines };
};

export const actions: Actions = {
	generateLines: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'payroll:*');
		const hotelId = event.locals.hotel!.id;

		const run = await getPayrollRun(hotelId, event.params.runId);
		if (!run) return fail(404, { error: 'Payroll run not found.' });

		try {
			await generatePayrollRunLines(hotelId, run.id);
			return { ok: 'Lines generated.' };
		} catch (e) {
			return fail(400, {
				error:
					e instanceof Error
						? e.message
						: 'Payroll computation is not yet implemented — see docs/standards/hr.md.'
			});
		}
	}
};
