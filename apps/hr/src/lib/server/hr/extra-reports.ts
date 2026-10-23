import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import {
	employeeAssignments,
	employees,
	establishments,
	payrollBatches,
	payrollRunLines,
	payrollRuns
} from '$lib/server/db/schema/index';
import { listLoanTypes, listLoans, monthsAfter, scheduleStatus, skipMonthsByLoan } from './loans';
import { getOverview } from './remittance';
import type { ReportDoc, ReportParams } from './report-docs';

/** Five reports Main HR asks for at filing time and at month end. Each returns a plain `ReportDoc`. */

const longDate = (iso: string) =>
	new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const monthName = (ym: string) =>
	new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const FINAL = ['locked', 'released'];

// ---------------------------------------------------------------------------
// 1. Employee data completeness
// ---------------------------------------------------------------------------

export async function dataCompletenessDoc(organizationId: string, p: ReportParams): Promise<ReportDoc> {
	const rows = await db
		.select({
			e: employees,
			establishment: establishments.name,
			position: employeeAssignments.position
		})
		.from(employeeAssignments)
		.innerJoin(employees, eq(employees.id, employeeAssignments.employeeId))
		.innerJoin(establishments, eq(establishments.id, employeeAssignments.establishmentId))
		.where(
			and(
				eq(employees.organizationId, organizationId),
				lte(employeeAssignments.startDate, p.asOf),
				sql`(${employeeAssignments.endDate} is null or ${employeeAssignments.endDate} >= ${p.asOf})`,
				isNull(employees.deletedAt),
				sql`${employees.status} <> 'separated'`,
				p.est ? eq(employeeAssignments.establishmentId, p.est) : undefined
			)
		)
		.orderBy(asc(employees.lastName), asc(employees.firstName));

	const seen = new Set<string>();
	const counts = new Map<string, number>();
	const out: Array<Array<string | number>> = [];
	let checked = 0;
	for (const r of rows) {
		if (seen.has(r.e.id)) continue;
		seen.add(r.e.id);
		checked += 1;
		const ids = (r.e.govIds ?? {}) as { tin?: string; sss?: string; philhealth?: string; pagibig?: string };
		const disb = (r.e.disbursement ?? {}) as { method?: string; account_no?: string };
		const missing: string[] = [];
		if (!ids.tin) missing.push('TIN');
		if (r.e.sssCovered && !ids.sss) missing.push('SSS no.');
		if (r.e.philhealthCovered && !ids.philhealth) missing.push('PhilHealth no.');
		if (r.e.pagibigCovered && !ids.pagibig) missing.push('Pag-IBIG no.');
		if (!r.e.address) missing.push('Address');
		if (disb.method && disb.method !== 'cash' && !disb.account_no) missing.push('Bank account');
		if (missing.length === 0) continue;
		for (const m of missing) counts.set(m, (counts.get(m) ?? 0) + 1);
		out.push([r.e.employeeNo, `${r.e.lastName}, ${r.e.firstName}`, r.establishment, r.position, missing.length, missing.join(', ')]);
	}
	out.sort((a, b) => Number(b[4]) - Number(a[4]) || String(a[1]).localeCompare(String(b[1])));
	return {
		key: 'data-completeness',
		title: 'Employee data completeness',
		period: `As of ${longDate(p.asOf)}`,
		stats: [
			{ label: 'People checked', value: String(checked) },
			{ label: 'With gaps', value: String(out.length) },
			...['TIN', 'SSS no.', 'PhilHealth no.', 'Pag-IBIG no.', 'Address', 'Bank account'].map((l) => ({
				label: `Missing ${l}`,
				value: String(counts.get(l) ?? 0)
			}))
		],
		notes: [
			'Current staff only. An agency number is only expected where the person is covered by that agency; a bank account only where pay is not cash.',
			'Fix these before the BIR 2316, the 1604-C alphalist and the agency remittances, which cannot be filed without them.'
		],
		sections: [
			{
				title: 'People with something missing',
				head: ['No.', 'Name', 'Establishment', 'Position', 'Gaps', 'Missing'],
				rows: out,
				numCols: [4]
			}
		]
	};
}

// ---------------------------------------------------------------------------
// 2. Contributions year to date
// ---------------------------------------------------------------------------

const sumJson = (col: typeof payrollRunLines.deductions | typeof payrollRunLines.employerContributions, key: string) =>
	sql<number>`coalesce(sum((${col}->>${key})::bigint), 0)::bigint`;

export async function contributionsYtdDoc(organizationId: string, p: ReportParams): Promise<ReportDoc> {
	const d = payrollRunLines.deductions;
	const c = payrollRunLines.employerContributions;
	const rows = await db
		.select({
			employeeId: payrollRunLines.employeeId,
			no: employees.employeeNo,
			last: employees.lastName,
			first: employees.firstName,
			govIds: employees.govIds,
			sssEe: sumJson(d, 'sss_ee'),
			sssEr: sumJson(c, 'sss_er'),
			ec: sumJson(c, 'ecc'),
			phEe: sumJson(d, 'philhealth_ee'),
			phEr: sumJson(c, 'philhealth_er'),
			piEe: sumJson(d, 'pagibig_ee'),
			piEr: sumJson(c, 'pagibig_er')
		})
		.from(payrollRunLines)
		.innerJoin(payrollBatches, eq(payrollBatches.id, payrollRunLines.batchId))
		.innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunLines.runId))
		.innerJoin(employees, eq(employees.id, payrollRunLines.employeeId))
		.where(
			and(
				eq(payrollRuns.organizationId, organizationId),
				inArray(payrollBatches.status, FINAL),
				sql`${payrollRuns.payDate} between ${`${p.year}-01-01`} and ${`${p.year}-12-31`}`
			)
		)
		.groupBy(payrollRunLines.employeeId, employees.employeeNo, employees.lastName, employees.firstName, employees.govIds)
		.orderBy(asc(employees.lastName), asc(employees.firstName));

	const n = (v: unknown) => Number(v);
	const table = rows.map((r) => {
		const g = (r.govIds ?? {}) as { sss?: string; philhealth?: string; pagibig?: string };
		return [
			r.no,
			`${r.last}, ${r.first}`,
			g.sss ?? '—',
			n(r.sssEe),
			n(r.sssEr),
			n(r.ec),
			g.philhealth ?? '—',
			n(r.phEe),
			n(r.phEr),
			g.pagibig ?? '—',
			n(r.piEe),
			n(r.piEr)
		];
	});
	const total = (i: number) => table.reduce((t, r) => t + Number(r[i]), 0);
	const ee = total(3) + total(7) + total(10);
	const er = total(4) + total(5) + total(8) + total(11);
	return {
		key: 'contributions-ytd',
		title: `Contributions year to date ${p.year}`,
		period: `Calendar year ${p.year}`,
		stats: [
			{ label: 'People', value: String(table.length) },
			{ label: 'Employee shares', value: '', money: true, raw: ee },
			{ label: 'Employer shares', value: '', money: true, raw: er },
			{ label: 'SSS', value: '', money: true, raw: total(3) + total(4) + total(5) },
			{ label: 'PhilHealth', value: '', money: true, raw: total(7) + total(8) },
			{ label: 'Pag-IBIG', value: '', money: true, raw: total(10) + total(11) }
		],
		notes: [
			'From locked and released payslips paid in the year. SSS includes the employer EC.',
			'Employee shares are what was deducted from pay; employer shares are the company\'s own cost and are not deducted.'
		],
		sections: [
			{
				title: 'By employee',
				head: ['No.', 'Name', 'SSS no.', 'SSS (EE)', 'SSS (ER)', 'EC (ER)', 'PhilHealth no.', 'PhilHealth (EE)', 'PhilHealth (ER)', 'Pag-IBIG no.', 'Pag-IBIG (EE)', 'Pag-IBIG (ER)'],
				rows: [...table, ...(table.length ? [['', 'Total', '', total(3), total(4), total(5), '', total(7), total(8), '', total(10), total(11)]] : [])],
				moneyCols: [3, 4, 5, 7, 8, 10, 11],
				numCols: [3, 4, 5, 7, 8, 10, 11]
			}
		]
	};
}

// ---------------------------------------------------------------------------
// 3. Payroll variance
// ---------------------------------------------------------------------------

/** A change in gross pay beyond this share of last month's is flagged for a look before locking. */
const VARIANCE_FLAG = 0.15;

export async function payrollVarianceDoc(organizationId: string, p: ReportParams): Promise<ReportDoc> {
	const month = p.toMonth;
	const prev = monthsAfter(month, -1);
	const found = await db
		.select({
			employeeId: payrollRunLines.employeeId,
			no: employees.employeeNo,
			last: employees.lastName,
			first: employees.firstName,
			month: sql<string>`to_char(${payrollRuns.payDate}, 'YYYY-MM')`,
			gross: sql<number>`coalesce(sum(${payrollRunLines.grossCentavos}), 0)::bigint`,
			net: sql<number>`coalesce(sum(${payrollRunLines.netPayCentavos}), 0)::bigint`
		})
		.from(payrollRunLines)
		.innerJoin(payrollBatches, eq(payrollBatches.id, payrollRunLines.batchId))
		.innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunLines.runId))
		.innerJoin(employees, eq(employees.id, payrollRunLines.employeeId))
		.where(
			and(
				eq(payrollRuns.organizationId, organizationId),
				inArray(payrollBatches.status, p.drafts ? [...FINAL, 'draft'] : FINAL),
				inArray(sql`to_char(${payrollRuns.payDate}, 'YYYY-MM')`, [month, prev]),
				p.est ? eq(payrollRunLines.establishmentId, p.est) : undefined
			)
		)
		.groupBy(payrollRunLines.employeeId, employees.employeeNo, employees.lastName, employees.firstName, sql`to_char(${payrollRuns.payDate}, 'YYYY-MM')`);

	const people = new Map<string, { no: string; name: string; cur: number; prev: number; curNet: number; prevNet: number }>();
	for (const r of found) {
		const row = people.get(r.employeeId) ?? { no: r.no, name: `${r.last}, ${r.first}`, cur: 0, prev: 0, curNet: 0, prevNet: 0 };
		if (r.month === month) {
			row.cur = Number(r.gross);
			row.curNet = Number(r.net);
		} else {
			row.prev = Number(r.gross);
			row.prevNet = Number(r.net);
		}
		people.set(r.employeeId, row);
	}
	const flagOf = (r: { cur: number; prev: number }) => {
		if (r.prev === 0 && r.cur > 0) return 'New this month';
		if (r.cur === 0 && r.prev > 0) return 'Not paid this month';
		if (r.prev > 0 && Math.abs(r.cur - r.prev) / r.prev > VARIANCE_FLAG) return 'Check';
		return '';
	};
	const list = [...people.values()]
		.map((r) => ({ ...r, diff: r.cur - r.prev, flag: flagOf(r) }))
		.sort((a, b) => Number(!!b.flag) - Number(!!a.flag) || Math.abs(b.diff) - Math.abs(a.diff));
	const sum = (f: (r: (typeof list)[number]) => number) => list.reduce((t, r) => t + f(r), 0);
	return {
		key: 'payroll-variance',
		title: 'Payroll variance',
		period: `${monthName(month)} against ${monthName(prev)}`,
		stats: [
			{ label: 'People', value: String(list.length) },
			{ label: `Gross ${monthName(month)}`, value: '', money: true, raw: sum((r) => r.cur) },
			{ label: `Gross ${monthName(prev)}`, value: '', money: true, raw: sum((r) => r.prev) },
			{ label: 'Change', value: '', money: true, raw: sum((r) => r.diff) },
			{ label: 'To check', value: String(list.filter((r) => r.flag).length) }
		],
		notes: [
			`Months are by pay date, comparing the "To month" with the month before it. A change of more than ${Math.round(VARIANCE_FLAG * 100)}% in gross pay, or someone paid in only one of the two months, is flagged.`,
			'Locked and released payslips' + (p.drafts ? ', plus drafts, which can still change.' : '. Tick "Include draft payslips" to review a batch before locking it.'),
			'A flag is a prompt to look, not an error: raises, unpaid leave, overtime and one-off items all move pay.'
		],
		sections: [
			{
				title: 'By employee',
				head: ['No.', 'Name', monthName(prev), monthName(month), 'Change', 'Change %', 'Net pay', 'Flag'],
				rows: list.map((r) => [
					r.no,
					r.name,
					r.prev,
					r.cur,
					r.diff,
					r.prev > 0 ? `${r.diff >= 0 ? '+' : ''}${((r.diff / r.prev) * 100).toFixed(1)}%` : '—',
					r.curNet,
					r.flag
				]),
				moneyCols: [2, 3, 4, 6],
				numCols: [2, 3, 4, 5, 6]
			}
		]
	};
}

// ---------------------------------------------------------------------------
// 4. Loans outstanding
// ---------------------------------------------------------------------------

export async function loansOutstandingDoc(organizationId: string, p: ReportParams): Promise<ReportDoc> {
	const [loans, types] = await Promise.all([
		listLoans(organizationId, { statuses: ['active', 'paused'] }),
		listLoanTypes(organizationId)
	]);
	const thisMonth = p.asOf.slice(0, 7);
	const skips = await skipMonthsByLoan(loans.map((l) => l.id));
	const typeName = new Map(types.map((t) => [t.key, t.name]));
	const rows = loans.map((l) => {
		const s =
			l.status === 'active'
				? scheduleStatus({
						principal: l.principalCentavos,
						alreadyPaid: l.alreadyPaidCentavos,
						amortization: l.amortizationCentavos,
						startPeriod: l.startPeriod,
						thisMonth,
						skips: skips.get(l.id) ?? new Set(),
						paidSince: l.deductedCentavos + l.paidOutsideCentavos
					})
				: { behind: 0, expectedEnd: null as string | null };
		return { l, behind: s.behind, end: s.expectedEnd };
	});
	rows.sort((a, b) => b.behind - a.behind || b.l.balanceCentavos - a.l.balanceCentavos);
	const leftOwing = rows.filter((r) => r.l.employeeStatus === 'separated' && r.l.balanceCentavos > 0);
	return {
		key: 'loans-outstanding',
		title: 'Loans outstanding',
		period: `As of ${longDate(p.asOf)}`,
		stats: [
			{ label: 'Open loans', value: String(rows.length) },
			{ label: 'Still owed', value: '', money: true, raw: rows.reduce((t, r) => t + r.l.balanceCentavos, 0) },
			{ label: 'Behind schedule', value: String(rows.filter((r) => r.behind > 0).length) },
			{ label: 'Behind by', value: '', money: true, raw: rows.reduce((t, r) => t + r.behind, 0) },
			{ label: 'Owed by people who left', value: '', money: true, raw: leftOwing.reduce((t, r) => t + r.l.balanceCentavos, 0) }
		],
		notes: [
			'Active and paused loans. Balance is the principal less what was paid before the system, deducted by locked payslips and received outside payroll.',
			`"Behind" compares what the monthly amount says should have been paid before ${monthName(thisMonth)} with what was paid; the current month is not counted.`
		],
		sections: [
			{
				title: 'By loan',
				head: ['No.', 'Name', 'Loan', 'Reference', 'Principal', 'Paid', 'Balance', 'Per month', 'Behind', 'Ends', 'Status', 'Employee'],
				rows: rows.map((r) => [
					r.l.employeeNo,
					r.l.employeeName,
					typeName.get(r.l.kind) ?? r.l.kind,
					r.l.referenceNo ?? '—',
					r.l.principalCentavos,
					r.l.alreadyPaidCentavos + r.l.deductedCentavos + r.l.paidOutsideCentavos,
					r.l.balanceCentavos,
					r.l.amortizationCentavos,
					r.behind,
					r.end ?? '—',
					r.l.status === 'paused' ? 'Paused' : 'Active',
					r.l.employeeStatus === 'separated' ? 'Left' : 'Employed'
				]),
				moneyCols: [4, 5, 6, 7, 8],
				numCols: [4, 5, 6, 7, 8]
			}
		]
	};
}

// ---------------------------------------------------------------------------
// 5. BIR 1601-C monthly data
// ---------------------------------------------------------------------------

export async function bir1601cDoc(organizationId: string, p: ReportParams, today: string): Promise<ReportDoc> {
	const lines = await db
		.select({
			month: sql<string>`to_char(${payrollRuns.payDate}, 'YYYY-MM')`,
			people: sql<number>`count(distinct ${payrollRunLines.employeeId})::int`,
			gross: sql<number>`coalesce(sum(${payrollRunLines.grossCentavos}), 0)::bigint`,
			exempt: sql<number>`coalesce(sum((${payrollRunLines.detail}->>'nonTaxableCentavos')::bigint), 0)::bigint`,
			contributions: sql<number>`coalesce(sum(
				coalesce((${payrollRunLines.deductions}->>'sss_ee')::bigint, 0)
				+ coalesce((${payrollRunLines.deductions}->>'philhealth_ee')::bigint, 0)
				+ coalesce((${payrollRunLines.deductions}->>'pagibig_ee')::bigint, 0)
			), 0)::bigint`,
			withheld: sql<number>`coalesce(sum((${payrollRunLines.deductions}->>'withholding_tax')::bigint), 0)::bigint`,
			returned: sql<number>`coalesce(sum(greatest(0, -coalesce((${payrollRunLines.detail}->>'annualTaxAdjustmentCentavos')::bigint, 0))), 0)::bigint`
		})
		.from(payrollRunLines)
		.innerJoin(payrollBatches, eq(payrollBatches.id, payrollRunLines.batchId))
		.innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunLines.runId))
		.where(
			and(
				eq(payrollRuns.organizationId, organizationId),
				inArray(payrollBatches.status, FINAL),
				sql`${payrollRuns.payDate} between ${`${p.year}-01-01`} and ${`${p.year}-12-31`}`
			)
		)
		.groupBy(sql`to_char(${payrollRuns.payDate}, 'YYYY-MM')`);
	const byMonth = new Map(lines.map((r) => [r.month, r]));

	const months = Array.from({ length: 12 }, (_, i) => `${p.year}-${String(i + 1).padStart(2, '0')}`);
	const status = new Map<string, { status: string; dueDate: string | null }>();
	for (const m of months) {
		if (!byMonth.has(m)) continue;
		const bir = (await getOverview(organizationId, m, today)).agencies.find((a) => a.agency === 'bir');
		if (bir) status.set(m, { status: bir.status === 'remitted' ? 'Remitted' : bir.overdue ? 'Overdue' : 'Open', dueDate: bir.dueDate });
	}
	const table = months.map((m) => {
		const r = byMonth.get(m);
		const gross = Number(r?.gross ?? 0);
		const exempt = Number(r?.exempt ?? 0);
		const contrib = Number(r?.contributions ?? 0);
		const withheld = Number(r?.withheld ?? 0);
		const returned = Number(r?.returned ?? 0);
		const st = status.get(m);
		return [
			monthName(m),
			r?.people ?? 0,
			gross,
			exempt + contrib,
			Math.max(0, gross - exempt - contrib),
			withheld,
			returned,
			withheld - returned,
			st?.dueDate ?? '—',
			st?.status ?? (r ? '—' : 'No payroll')
		];
	});
	const total = (i: number) => table.reduce((t, r) => t + Number(r[i]), 0);
	return {
		key: '1601-c',
		title: `BIR 1601-C monthly data ${p.year}`,
		period: `Calendar year ${p.year}`,
		stats: [
			{ label: 'Compensation paid', value: '', money: true, raw: total(2) },
			{ label: 'Taxable compensation', value: '', money: true, raw: total(4) },
			{ label: 'Tax withheld', value: '', money: true, raw: total(5) },
			{ label: 'Returned to employees', value: '', money: true, raw: total(6) },
			{ label: 'To remit', value: '', money: true, raw: total(7) }
		],
		notes: [
			'Per month, by pay date, from locked and released payslips. Tax returned at year-end is paid out of what was withheld, so it comes off what is remitted.',
			'Non-taxable includes exempt earnings and the employee SSS, PhilHealth and Pag-IBIG shares. The 13th month and other benefits are paid outside payroll and are not in these figures.',
			'These are the figures for the monthly return, not the form itself. Check them against the current BIR form and with your accountant before filing.'
		],
		sections: [
			{
				title: 'By month',
				head: ['Month', 'People', 'Compensation', 'Non-taxable', 'Taxable', 'Tax withheld', 'Returned', 'To remit', 'Due', 'Status'],
				rows: [...table, ['Total', '', total(2), total(3), total(4), total(5), total(6), total(7), '', '']],
				moneyCols: [2, 3, 4, 5, 6, 7],
				numCols: [1, 2, 3, 4, 5, 6, 7]
			}
		]
	};
}

