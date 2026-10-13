import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { getOrganization } from '$lib/server/establishments';
import {
	DAY_FACTORS,
	FACTOR_LABEL,
	PayrollError,
	createRun,
	getDayFactor,
	listRuns,
	runFormSchema,
	saveDayFactor
} from '$lib/server/hr/payroll';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.access, 'payroll:*');
	const org = await getOrganization();
	const [runs, dayFactor] = await Promise.all([listRuns(org.id), getDayFactor(org.id)]);
	return {
		runs: runs.map((r) => ({
			id: r.id,
			cutoffStart: r.cutoffStart,
			cutoffEnd: r.cutoffEnd,
			payDate: r.payDate,
			frequency: r.frequency,
			batchCount: r.batchCount,
			locked: r.locked,
			released: r.released
		})),
		dayFactor,
		factors: DAY_FACTORS.map((f) => ({ value: f, label: FACTOR_LABEL[f]! }))
	};
};

export const actions: Actions = {
	saveSettings: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'payroll:*');
		const parsed = z.coerce.number().int().safeParse((await request.formData()).get('dayFactor'));
		if (!parsed.success) return fail(400, { error: 'Choose a working-day factor.' });
		try {
			const org = await getOrganization();
			await saveDayFactor(org.id, parsed.data);
			await writeAudit({
				actor: locals.user,
				action: 'payroll.settings',
				entityType: 'organization',
				entityId: org.id,
				after: { dayFactor: parsed.data }
			});
		} catch (e) {
			if (e instanceof PayrollError) return fail(400, { error: e.message });
			throw e;
		}
		return { ok: 'Saved. Runs created from now on use this factor.' };
	},

	create: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'payroll:*');
		const parsed = runFormSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]!.message });
		let id: string;
		try {
			const org = await getOrganization();
			const run = await createRun(org.id, parsed.data, locals.user!.id);
			id = run.id;
			await writeAudit({
				actor: locals.user,
				action: 'payroll.run.create',
				entityType: 'payroll_run',
				entityId: run.id,
				after: { cutoffStart: run.cutoffStart, cutoffEnd: run.cutoffEnd }
			});
		} catch (e) {
			if (e instanceof PayrollError) return fail(400, { error: e.message });
			throw e;
		}
		redirect(303, `/payroll/${id}`);
	}
};
