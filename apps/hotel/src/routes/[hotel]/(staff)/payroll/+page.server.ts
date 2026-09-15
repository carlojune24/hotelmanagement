import { fail, redirect } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { createPayrollRun, listPayrollRuns, payrollRunFormSchema } from '$lib/server/hr/payroll';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'payroll:*');
	const runs = await listPayrollRuns(locals.hotel!.id);
	return { runs };
};

export const actions: Actions = {
	create: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'payroll:*');
		const hotelId = event.locals.hotel!.id;

		const raw = Object.fromEntries(await event.request.formData());
		const parsed = payrollRunFormSchema.safeParse(raw);
		if (!parsed.success) return fail(400, { error: 'Check the cutoff and pay dates.' });

		const run = await createPayrollRun(hotelId, parsed.data);
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'payroll_run.create',
			entityType: 'payroll_run',
			entityId: run.id,
			after: parsed.data
		});
		redirect(303, `/${event.params.hotel}/payroll/${run.id}`);
	}
};
