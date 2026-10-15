import { fail } from '@sveltejs/kit';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { db } from '$lib/server/db/index';
import { establishments, payrollBatches, payrollRuns } from '$lib/server/db/schema/index';
import { getOrganization } from '$lib/server/establishments';
import { annualizationRows, applyAnnualization } from '$lib/server/hr/annualization';
import { PayrollError } from '$lib/server/hr/payroll';
import { businessDateFor } from '$lib/server/time';
import type { Actions, PageServerLoad } from './$types';

const yearOf = (v: string | null, today: string) => {
	const p = z.coerce.number().int().min(2000).max(2100).safeParse(v);
	return p.success ? p.data : Number(today.slice(0, 4));
};

/** Year-end annualization: each person's tax for the whole year against what was withheld. Main HR only. */
export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.access, 'payroll:*');
	const org = await getOrganization();
	const year = yearOf(url.searchParams.get('year'), businessDateFor('Asia/Manila'));
	const drafts = await db
			.select({
				batchId: payrollBatches.id,
				cutoffStart: payrollRuns.cutoffStart,
				cutoffEnd: payrollRuns.cutoffEnd,
				payDate: payrollRuns.payDate,
				establishment: establishments.name
			})
			.from(payrollBatches)
			.innerJoin(payrollRuns, eq(payrollRuns.id, payrollBatches.runId))
			.innerJoin(establishments, eq(establishments.id, payrollBatches.establishmentId))
			.where(
				and(
					eq(payrollRuns.organizationId, org.id),
					eq(payrollBatches.status, 'draft'),
					sql`${payrollRuns.payDate} between ${`${year}-01-01`} and ${`${year}-12-31`}`
				)
			)
			.orderBy(asc(payrollRuns.payDate), asc(establishments.name));
	// The year as it will stand once its draft payrolls are final, so the figures are the full-year settlement
	// and not eleven months of it. Without a draft it is simply what has been locked.
	const rows = await annualizationRows(org.id, year, drafts.length ? { batchIds: drafts.map((d) => d.batchId) } : null);
	const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((t, r) => t + f(r), 0);
	return {
		year,
		rows,
		drafts,
		totals: {
			people: rows.length,
			taxDue: sum((r) => r.taxDue),
			withheld: sum((r) => r.withheld + r.prevWithheld),
			additional: sum((r) => Math.max(0, r.settlement)),
			refund: sum((r) => Math.max(0, -r.settlement))
		}
	};
};

export const actions: Actions = {
	apply: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'payroll:*');
		const fd = await request.formData();
		const parsed = z
			.object({ batchId: z.string().uuid('Pick the batch to settle in.'), year: z.coerce.number().int().min(2000).max(2100) })
			.safeParse({ batchId: fd.get('batchId'), year: fd.get('year') });
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the form.' });
		try {
			const org = await getOrganization();
			const r = await applyAnnualization(org.id, parsed.data.year, parsed.data.batchId);
			await writeAudit({
				actor: locals.user,
				action: 'payroll.annualization',
				entityType: 'payroll_batch',
				entityId: parsed.data.batchId,
				after: { year: parsed.data.year, applied: r.applied, missing: r.missing.length }
			});
			return {
				ok:
					`Settlement applied to ${r.applied} ${r.applied === 1 ? 'person' : 'people'}.` +
					(r.missing.length ? ` Not in this batch, so not settled: ${r.missing.join('; ')}.` : '')
			};
		} catch (e) {
			if (e instanceof PayrollError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
