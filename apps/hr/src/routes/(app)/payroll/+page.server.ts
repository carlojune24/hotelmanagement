import { fail, redirect } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { getOrganization } from '$lib/server/establishments';
import {
	PayrollError,
	countRuns,
	createRun,
	getDayFactor,
	listRuns,
	runFormSchema
} from '$lib/server/hr/payroll';
import type { Actions, PageServerLoad } from './$types';

const PAGE_SIZES = [10, 25, 50, 100];

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.access, 'payroll:*');
	const org = await getOrganization();
	const size = Number(url.searchParams.get('size'));
	const pageSize = PAGE_SIZES.includes(size) ? size : 10;
	const q = (url.searchParams.get('q') ?? '').trim().slice(0, 40);
	const total = await countRuns(org.id, q);
	const pageCount = Math.max(1, Math.ceil(total / pageSize));
	const page = Math.min(Math.max(1, Math.trunc(Number(url.searchParams.get('page'))) || 1), pageCount);
	const [runs, dayFactor] = await Promise.all([
		listRuns(org.id, { size: pageSize, offset: (page - 1) * pageSize }, q),
		getDayFactor(org.id)
	]);
	return {
		q,
		page,
		pageSize,
		pageCount,
		pageSizes: PAGE_SIZES,
		total,
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
		dayFactor
	};
};

export const actions: Actions = {
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
