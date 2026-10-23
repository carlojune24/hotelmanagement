import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requireCap, requireUser } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { db } from '$lib/server/db/index';
import { payrollBatches, payrollRuns } from '$lib/server/db/schema/index';
import { getOrganization } from '$lib/server/establishments';
import { annualizationRows } from '$lib/server/hr/annualization';
import { getRemittanceSettings } from '$lib/server/hr/remittance';
import { businessDateFor } from '$lib/server/time';
import type { PageServerLoad } from './$types';

/**
 * One BIR 2316 data sheet per employee for a year (`?year=`), or one person with `?employee=`. Main HR only;
 * every print is audited. This is the company's own sheet, not the official form.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	requireUser(locals.user, url.pathname + url.search);
	requireCap(locals.user, locals.access, 'payroll:*');
	const org = await getOrganization();
	const today = businessDateFor('Asia/Manila');
	const parsed = z.coerce.number().int().min(2000).max(2100).safeParse(url.searchParams.get('year'));
	const year = parsed.success ? parsed.data : Number(today.slice(0, 4)) - 1;
	const only = url.searchParams.get('employee');
	const [all, settings] = await Promise.all([annualizationRows(org.id, year), getRemittanceSettings(org.id)]);
	const rows = only ? all.filter((r) => r.employeeId === only) : all;
	const [{ drafts } = { drafts: 0 }] = await db
		.select({ drafts: sql<number>`count(*)::int` })
		.from(payrollBatches)
		.innerJoin(payrollRuns, eq(payrollRuns.id, payrollBatches.runId))
		.where(
			and(
				eq(payrollRuns.organizationId, org.id),
				eq(payrollBatches.status, 'draft'),
				sql`${payrollRuns.payDate} between ${`${year}-01-01`} and ${`${year}-12-31`}`
			)
		);
	await writeAudit({
		actor: locals.user,
		action: 'tax.certificate_print',
		entityType: 'organization',
		entityId: org.id,
		after: { year, people: rows.length }
	});
	return {
		year,
		drafts,
		printedOn: today,
		employer: { name: org.name, tin: settings.employer.tin ?? '' },
		rows
	};
};
