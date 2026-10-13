import { error } from '@sveltejs/kit';
import { canAt } from '$lib/authz';
import { requireUser } from '$lib/server/auth/rbac';
import { db } from '$lib/server/db/index';
import { establishments } from '$lib/server/db/schema/index';
import { getLine, maskId } from '$lib/server/hr/payroll';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

/**
 * One payslip. Main HR may open any (a draft is watermarked); a manager only sees a *released*
 * payslip of someone whose home establishment is the one in the URL — checked here, not just in
 * the list, so a guessed line id can never expose another business's pay.
 */
/** Which deductions were left out because Main HR marked the person not covered (frozen on the line). */
function notCoveredLabels(detail: unknown): string[] {
	const c = (detail as { coverage?: Record<string, unknown> } | null)?.coverage;
	if (!c) return [];
	return [
		c.sss === false ? 'SSS' : null,
		c.philhealth === false ? 'PhilHealth' : null,
		c.pagibig === false ? 'Pag-IBIG' : null,
		c.withholdingExempt === true ? 'withholding tax' : null
	].filter((x): x is string => x !== null);
}

export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireUser(locals.user, url.pathname);
	const est = locals.establishment;
	if (!est) error(404, 'Not found');
	const user = locals.user!;
	const access = locals.access!;

	const row = await getLine(params.lineId);
	if (!row || row.line.establishmentId !== est.id) error(404, 'Not found');

	const isPayroll = user.isSystemAdmin || canAt(access, 'payroll:*');
	const mayRead = isPayroll || (canAt(access, 'payslip:read', est.id) && row.batchStatus === 'released');
	if (!mayRead) error(404, 'Not found');

	const header = await db
		.select({ legalName: establishments.legalName, name: establishments.name, address: establishments.addressLine, city: establishments.city })
		.from(establishments)
		.where(eq(establishments.id, est.id))
		.then((r) => r.at(0));

	const l = row.line;
	const gov = (l.govIds ?? {}) as Record<string, string | undefined>;
	return {
		draft: row.batchStatus !== 'released',
		company: { name: header?.legalName || header?.name || est.name, address: [header?.address, header?.city].filter(Boolean).join(', ') },
		establishment: est.name,
		period: { start: row.run.cutoffStart, end: row.run.cutoffEnd, payDate: row.run.payDate },
		employee: {
			name: l.employeeName,
			no: l.employeeNo,
			position: l.position,
			department: l.department,
			sss: maskId(gov.sss),
			philhealth: maskId(gov.philhealth),
			pagibig: maskId(gov.pagibig),
			tin: maskId(gov.tin)
		},
		basis: { payBasis: l.payBasis, rate: l.baseRateCentavos },
		time: { days: l.daysWorked, regularMinutes: l.minutesRegular, otMinutes: l.minutesOvertime, nightMinutes: l.minutesNightDiff },
		earnings: l.earnings as Record<string, number>,
		deductions: l.deductions as Record<string, number>,
		notCovered: notCoveredLabels(l.detail),
		/** Each loan on this payslip: what was due and what the pay could cover. No reference numbers. */
		loans: ((l.detail as { loans?: Array<{ label: string; due: number; deducted: number }> } | null)?.loans ?? []).map(
			(x) => ({ label: x.label, due: x.due, deducted: x.deducted })
		),
		gross: l.grossCentavos,
		net: l.netPayCentavos
	};
};
