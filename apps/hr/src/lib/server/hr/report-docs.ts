import { attendanceReport, headcountReport, payrollSummary, turnoverReport } from './internal-reports';
import { monthsWithPayroll } from './reports';
import { thirteenthMonthReport } from './bonuses';
import { contractsDue } from './contracts';
import { bir1601cDoc, contributionsYtdDoc, dataCompletenessDoc, loansOutstandingDoc, payrollVarianceDoc } from './extra-reports';
import { annualizationRows, draftBatchIdsForYear } from './annualization';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { payrollBatches, payrollRuns } from '$lib/server/db/schema/index';

/**
 * Every internal report as one plain document — stats plus tables — so one page, one CSV route and one
 * print route can render all of them. Money cells hold centavos and are listed in `moneyCols`.
 */
export interface ReportSection {
	title: string;
	head: string[];
	rows: Array<Array<string | number>>;
	/** Column indexes holding centavos (shown as ₱, exported as plain pesos). */
	moneyCols?: number[];
	/** Column indexes right-aligned (numbers). */
	numCols?: number[];
}
export interface ReportDoc {
	key: ReportKey;
	title: string;
	/** Human period / date line, e.g. "January 2026 – March 2026". */
	period: string;
	stats: Array<{ label: string; value: string; money?: boolean; raw?: number }>;
	sections: ReportSection[];
	/** Shown above the figures when something affects how far they can be trusted. */
	notes: string[];
}

export const INTERNAL_REPORTS = [
	{ key: 'headcount', label: 'Headcount & demographics', filter: 'asOf', blurb: 'Who is employed on a date: by establishment, department, type, sex, age and tenure.' },
	{ key: 'payroll-summary', label: 'Payroll & compensation', filter: 'monthRange', blurb: 'Earnings, deductions, net pay and employer contributions from locked payslips.' },
	{ key: 'attendance', label: 'Attendance & leave', filter: 'dateRange', blurb: 'Days worked, absences, late and undertime, overtime and leave taken, from saved DTRs.' },
	{ key: '13th-month', label: '13th month pay', filter: 'year', blurb: 'Per person for a year: 13th month due, paid mid-year, year-end and in final pay, and who was not paid. For the DOLE report.' },
	{ key: 'data-completeness', label: 'Employee data completeness', filter: 'asOf', blurb: 'Who is missing a TIN, agency number, address or bank account, before filing.' },
	{ key: 'contributions-ytd', label: 'Contributions year to date', filter: 'year', blurb: 'SSS, PhilHealth and Pag-IBIG employee and employer shares per person for the year.' },
	{ key: 'payroll-variance', label: 'Payroll variance', filter: 'monthRange', blurb: 'Gross pay against the month before, per person, with unusual changes flagged.' },
	{ key: 'loans-outstanding', label: 'Loans outstanding', filter: 'asOf', blurb: 'Open loans with balance, behind schedule and end month, and who left owing.' },
	{ key: '1601-c', label: 'BIR 1601-C monthly data', filter: 'year', blurb: 'Per month: compensation, taxable pay, tax withheld, returned and what to remit, with due date and status.' },
	{ key: 'contracts-due', label: 'Contracts and probation due', filter: 'asOf', blurb: 'Contracts and probations ending soon or already ended without a replacement.' },
	{ key: 'year-end-tax', label: 'Year-end tax', filter: 'year', blurb: 'Income tax for the year against what was withheld, per employee, and what is still to withhold or return.' },
	{ key: '2316', label: 'BIR 2316 data', filter: 'year', blurb: 'Per employee for a year: compensation, non-taxable pay, taxable pay, tax due and tax withheld.' },
	{ key: '1604-c', label: 'BIR 1604-C alphalist', filter: 'year', blurb: 'The yearly alphalist of employees with compensation and tax withheld.' },
	{ key: 'turnover', label: 'Turnover & attrition', filter: 'dateRange', blurb: 'Separations by kind, voluntary vs involuntary, turnover and retention rates, tenure.' }
] as const;
export type ReportKey = (typeof INTERNAL_REPORTS)[number]['key'];
export const isReportKey = (k: string): k is ReportKey => INTERNAL_REPORTS.some((r) => r.key === k);

export interface ReportParams {
	asOf: string;
	/** Month range for payroll: YYYY-MM. */
	fromMonth: string;
	toMonth: string;
	from: string;
	to: string;
	/** Calendar year for the 13th-month report. */
	year: number;
	est: string;
	drafts: boolean;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const endOfMonth = (ym: string) => {
	const [y, m] = ym.split('-').map(Number);
	return `${ym}-${String(new Date(Date.UTC(y!, m!, 0)).getUTCDate()).padStart(2, '0')}`;
};

/** Filters from the URL with sensible defaults; `today` is the business date. */
export async function parseParams(organizationId: string, q: URLSearchParams, today: string): Promise<ReportParams> {
	const months = await monthsWithPayroll(organizationId);
	const latest = months[0] ?? today.slice(0, 7);
	const pick = (k: string, re: RegExp, fallback: string) => {
		const v = q.get(k) ?? '';
		return re.test(v) ? v : fallback;
	};
	const fromMonth = pick('fromMonth', MONTH, latest);
	const toMonth = pick('toMonth', MONTH, latest);
	return {
		asOf: pick('asOf', ISO, today),
		fromMonth: fromMonth <= toMonth ? fromMonth : toMonth,
		toMonth: fromMonth <= toMonth ? toMonth : fromMonth,
		year: Number(pick('year', /^20\d{2}$/, today.slice(0, 4))),
		from: pick('from', ISO, `${today.slice(0, 4)}-01-01`),
		to: pick('to', ISO, today),
		est: q.get('est') ?? '',
		drafts: q.get('drafts') === '1'
	};
}

const words = (s: string) => {
	const t = s.replaceAll('_', ' ');
	return t.charAt(0).toUpperCase() + t.slice(1);
};
const date = (iso: string) =>
	new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const monthName = (ym: string) =>
	new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const hm = (min: number) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;

const EARN_LABEL: Record<string, string> = {
	basic: 'Basic pay',
	overtime: 'Overtime',
	holiday_premium: 'Holiday premium',
	night_diff: 'Night differential',
	allowances: 'Allowances',
	other: 'Other earnings'
};
const DED_LABEL: Record<string, string> = {
	sss_ee: 'SSS (employee)',
	philhealth_ee: 'PhilHealth (employee)',
	pagibig_ee: 'Pag-IBIG (employee)',
	withholding_tax: 'Withholding tax',
	cash_advance: 'Cash advance',
	loans: 'Loans',
	tardiness_undertime: 'Late and undertime',
	other: 'Other deductions'
};
const ER_LABEL: Record<string, string> = {
	sss_er: 'SSS (employer)',
	philhealth_er: 'PhilHealth (employer)',
	pagibig_er: 'Pag-IBIG (employer)',
	ecc: 'EC (employer)'
};

export async function buildReportDoc(
	key: ReportKey,
	organizationId: string,
	p: ReportParams
): Promise<ReportDoc> {
	const estId = p.est || null;

	if (key === 'headcount') {
		const h = await headcountReport(organizationId, { asOf: p.asOf, establishmentId: estId });
		const two = (title: string, head: string, items: Array<{ label: string; count: number }>): ReportSection => ({
			title,
			head: [head, 'Employees'],
			rows: items.map((i) => [i.label, i.count]),
			numCols: [1]
		});
		return {
			key,
			title: 'Headcount & demographics',
			period: `As of ${date(p.asOf)}`,
			stats: [
				{ label: 'Employees', value: String(h.total) },
				{ label: 'Full-time', value: String(h.fullTime) },
				{ label: 'Part-time', value: String(h.partTime) }
			],
			notes: ['Full-time means every employment type except part-time.'],
			sections: [
				two('By establishment', 'Establishment', h.byEstablishment.map((e) => ({ label: e.name, count: e.count }))),
				two('By department', 'Department', h.byDepartment),
				two('By employment type', 'Type', h.byEmploymentType.map((t) => ({ ...t, label: words(t.label) }))),
				two('By sex', 'Sex', h.bySex.map((t) => ({ ...t, label: words(t.label) }))),
				two('By age', 'Age', h.byAge),
				two('By length of service', 'Tenure', h.byTenure),
				{
					title: 'People',
					head: ['No.', 'Name', 'Establishment', 'Department', 'Position', 'Type', 'Age', 'Years', 'Hired'],
					rows: h.people.map((x) => [x.employeeNo, x.name, x.establishment, x.department, x.position, words(x.employmentType), x.age, x.tenureYears, x.hiredOn]),
					numCols: [6, 7]
				}
			]
		};
	}

	if (key === 'payroll-summary') {
		const from = `${p.fromMonth}-01`;
		const to = endOfMonth(p.toMonth);
		const s = await payrollSummary(organizationId, { from, to, establishmentId: estId, includeDrafts: p.drafts });
		const t = s.total;
		const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
		const dedTotal = sum(t.deductions);
		const erTotal = sum(t.employer);
		const comp: Array<[string, number]> = [
			...Object.entries(t.earnings).map(([k, v]): [string, number] => [EARN_LABEL[k] ?? k, v]),
			['Gross pay', t.gross],
			...Object.entries(t.deductions).map(([k, v]): [string, number] => [DED_LABEL[k] ?? k, -v]),
			['Net pay', t.net],
			...Object.entries(t.employer).map(([k, v]): [string, number] => [ER_LABEL[k] ?? k, v])
		];
		const split = (title: string, head: string, rows: typeof s.byEstablishment): ReportSection => ({
			title,
			head: [head, 'People', 'Gross', 'Deductions', 'Net pay', 'Employer'],
			rows: rows.map((r) => [r.name, r.people, r.gross, sum(r.deductions), r.net, sum(r.employer)]),
			moneyCols: [2, 3, 4, 5],
			numCols: [1, 2, 3, 4, 5]
		});
		return {
			key,
			title: 'Payroll & compensation summary',
			period: p.fromMonth === p.toMonth ? monthName(p.fromMonth) : `${monthName(p.fromMonth)} – ${monthName(p.toMonth)}`,
			stats: [
				{ label: 'Employees paid', value: String(t.people) },
				{ label: 'Payslips', value: String(t.payslips) },
				{ label: 'Gross pay', value: '', money: true, raw: t.gross },
				{ label: 'Net pay', value: '', money: true, raw: t.net },
				{ label: 'Employer contributions', value: '', money: true, raw: erTotal }
			],
			notes: [
				'Locked and released payslips only' + (p.drafts ? ', plus drafts, which can still change.' : '.'),
				...(s.draftLines > 0 ? [`${s.draftLines} of ${t.payslips} payslips counted are still drafts.`] : []),
				`Deductions total ${(dedTotal / 100).toFixed(2)}; these figures are the payslip lines the payroll register prints.`
			],
			sections: [
				{ title: 'By component', head: ['Item', 'Amount'], rows: comp, moneyCols: [1], numCols: [1] },
				split('By establishment', 'Establishment', s.byEstablishment),
				split('By department', 'Department', s.byDepartment)
			]
		};
	}

	if (key === 'attendance') {
		const a = await attendanceReport(organizationId, { from: p.from, to: p.to, establishmentId: estId });
		const byEst = new Map<string, { people: number; days: number; abs: number; late: number; lateMin: number; under: number; paid: number; unpaid: number }>();
		for (const r of a.rows) {
			const e = byEst.get(r.establishment) ?? { people: 0, days: 0, abs: 0, late: 0, lateMin: 0, under: 0, paid: 0, unpaid: 0 };
			e.people += 1;
			e.days += r.daysWorked;
			e.abs += r.absences;
			e.late += r.lateCount;
			e.lateMin += r.lateMinutes;
			e.under += r.undertimeMinutes;
			e.paid += r.paidLeaveDays;
			e.unpaid += r.unpaidLeaveDays;
			byEst.set(r.establishment, e);
		}
		return {
			key,
			title: 'Attendance, leave & absenteeism',
			period: `${date(p.from)} – ${date(p.to)}`,
			stats: [
				{ label: 'People', value: String(a.rows.length) },
				{ label: 'Days worked', value: String(a.totals.daysWorked) },
				{ label: 'Absences', value: String(a.totals.absences) },
				{ label: 'Late', value: `${a.totals.lateCount} (${hm(a.totals.lateMinutes)})` },
				{ label: 'Leave days', value: String(Math.round((a.totals.paidLeaveDays + a.totals.unpaidLeaveDays) * 100) / 100) }
			],
			notes: ['From saved DTR rows; leave counts approved requests that start in the period.'],
			sections: [
				{
					title: 'By establishment',
					head: ['Establishment', 'People', 'Days worked', 'Absences', 'Late (times)', 'Late', 'Undertime', 'Paid leave', 'Unpaid leave'],
					rows: [...byEst.entries()].map(([n, e]) => [n, e.people, e.days, e.abs, e.late, hm(e.lateMin), hm(e.under), e.paid, e.unpaid]),
					numCols: [1, 2, 3, 4, 7, 8]
				},
				{
					title: 'By person',
					head: ['No.', 'Name', 'Establishment', 'Days worked', 'Absences', 'Late (times)', 'Late', 'Undertime', 'Overtime', 'Unapproved OT', 'Paid leave', 'Unpaid leave'],
					rows: a.rows.map((r) => [
						r.employeeNo,
						r.name,
						r.establishment,
						r.daysWorked,
						r.absences,
						r.lateCount,
						hm(r.lateMinutes),
						hm(r.undertimeMinutes),
						hm(r.overtimeMinutes),
						hm(r.unapprovedOvertimeMinutes),
						r.paidLeaveDays,
						r.unpaidLeaveDays
					]),
					numCols: [3, 4, 5, 10, 11]
				}
			]
		};
	}

	if (key === 'contracts-due') {
		const due = await contractsDue(organizationId, p.asOf, 60);
		return {
			key,
			title: 'Contracts and probation due',
			period: `As of ${date(p.asOf)}, ending within 60 days`,
			stats: [
				{ label: 'Ending within 60 days', value: String(due.filter((d) => !d.overdue).length) },
				{ label: 'Already ended', value: String(due.filter((d) => d.overdue).length) }
			],
			notes: [
				'A contract is listed until a newer, non-void contract for the same person replaces it. A probationary employee kept past the end without a decision becomes a regular employee by law.'
			],
			sections: [
				{
					title: 'Ending soon or ended',
					head: ['No.', 'Name', 'Establishment', 'Type', 'Position', 'Ends', 'Days left', 'Status'],
					rows: due.map((d) => [
						d.employeeNo,
						d.employeeName,
						d.establishment ?? '—',
						words(d.kind),
						d.position,
						d.endDate!,
						d.overdue ? 0 : d.daysLeft,
						d.overdue ? 'Ended, no replacement' : d.daysLeft <= 14 ? 'Ends soon' : 'Upcoming'
					]),
					numCols: [6]
				}
			]
		};
	}
	if (key === 'data-completeness') return dataCompletenessDoc(organizationId, p);
	if (key === 'contributions-ytd') return contributionsYtdDoc(organizationId, p);
	if (key === 'payroll-variance') return payrollVarianceDoc(organizationId, p);
	if (key === 'loans-outstanding') return loansOutstandingDoc(organizationId, p);
	if (key === '1601-c') return bir1601cDoc(organizationId, p, p.asOf);

	if (key === 'year-end-tax') {
		const draftIds = await draftBatchIdsForYear(organizationId, p.year);
		const rows = await annualizationRows(organizationId, p.year, draftIds.length ? { batchIds: draftIds } : null);
		const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((t, r) => t + f(r), 0);
		const state = (r: (typeof rows)[number]) =>
			r.settlement === 0
				? 'Settled'
				: r.status === 'separated'
					? 'Settle in final pay'
					: r.appliedInDraft === r.settlement
						? 'Applied to the draft payslip'
						: r.settlement > 0
							? 'Withhold'
							: 'Return';
		const missingTin = rows.filter((r) => !r.tin).length;
		return {
			key,
			title: `Year-end tax ${p.year}`,
			period: `Calendar year ${p.year}`,
			stats: [
				{ label: 'Employees', value: String(rows.length) },
				{ label: 'Tax due for the year', value: '', money: true, raw: sum((r) => r.taxDue) },
				{ label: 'Withheld so far', value: '', money: true, raw: sum((r) => r.withheld + r.prevWithheld) },
				{ label: 'Still to withhold', value: '', money: true, raw: sum((r) => Math.max(0, r.settlement)) },
				{ label: 'To return', value: '', money: true, raw: sum((r) => Math.max(0, -r.settlement)) }
			],
			notes: [
				'Locked and released payslips paid in the year' +
					(draftIds.length > 0
						? `, plus ${draftIds.length} draft ${draftIds.length === 1 ? 'batch' : 'batches'} counted as if final`
						: '') +
					', and the 13th month and other benefits issued over the year.',
				'Taxable pay is gross less exempt earnings and the employee SSS, PhilHealth and Pag-IBIG shares, plus any 13th month and other benefits above ₱90,000 and pay from a previous employer for the year.',
				...(missingTin > 0 ? [`${missingTin} ${missingTin === 1 ? 'person has' : 'people have'} no TIN on file.`] : []),
				'Apply the settlement from Payroll → Year-end tax. Check the figures with your accountant before relying on them for filing.'
			],
			sections: [
				{
					title: 'By employee',
					head: ['No.', 'Name', 'Gross pay', 'Exempt & contributions', 'Bonus over ₱90,000', 'Taxable', 'Tax due', 'Withheld', 'Settlement', 'Status'],
					rows: [
						...rows.map((r) => [
							r.employeeNo,
							r.name,
							r.gross,
							r.exemptEarnings + r.contributions,
							r.benefitsTaxable,
							r.taxable,
							r.taxDue,
							r.withheld + r.prevWithheld,
							r.settlement,
							state(r)
						]),
						...(rows.length > 0
							? [['', 'Total', sum((r) => r.gross), sum((r) => r.exemptEarnings + r.contributions), sum((r) => r.benefitsTaxable), sum((r) => r.taxable), sum((r) => r.taxDue), sum((r) => r.withheld + r.prevWithheld), sum((r) => r.settlement), '']]
							: [])
					],
					moneyCols: [2, 3, 4, 5, 6, 7, 8],
					numCols: [2, 3, 4, 5, 6, 7, 8]
				}
			]
		};
	}

	if (key === '2316' || key === '1604-c') {
		const rows = await annualizationRows(organizationId, p.year);
		const nonTaxable = (r: (typeof rows)[number]) => r.benefitsExempt + r.exemptEarnings + r.contributions;
		const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((t, r) => t + f(r), 0);
		const missingTin = rows.filter((r) => !r.tin).length;
		const [{ drafts } = { drafts: 0 }] = await db
			.select({ drafts: sql<number>`count(*)::int` })
			.from(payrollBatches)
			.innerJoin(payrollRuns, eq(payrollRuns.id, payrollBatches.runId))
			.where(
				and(
					eq(payrollRuns.organizationId, organizationId),
					eq(payrollBatches.status, 'draft'),
					sql`${payrollRuns.payDate} between ${`${p.year}-01-01`} and ${`${p.year}-12-31`}`
				)
			);
		const common = {
			period: `Calendar year ${p.year}`,
			stats: [
				{ label: 'Employees', value: String(rows.length) },
				{ label: 'Taxable compensation', value: '', money: true, raw: sum((r) => r.taxable) },
				{ label: 'Tax due', value: '', money: true, raw: sum((r) => r.taxDue) },
				{ label: 'Tax withheld', value: '', money: true, raw: sum((r) => r.withheld + r.prevWithheld) }
			],
			notes: [
				'From locked and released payslips paid in the year, plus the 13th month and other benefits issued in it. Run Year-end tax under Payroll and lock the settlement first, or the over/under column will show what is still to be settled.',
				...(drafts > 0
					? [`${drafts} draft payroll ${drafts === 1 ? 'batch' : 'batches'} paid in ${p.year} ${drafts === 1 ? 'is' : 'are'} not locked yet and not counted here, so these figures are incomplete until they are.`]
					: []),
				...(missingTin > 0 ? [`${missingTin} ${missingTin === 1 ? 'person has' : 'people have'} no TIN on file; the BIR will not accept the alphalist without it.`] : []),
				'The layout follows the BIR forms but is not the official form; check it against the current BIR template and with your accountant before filing.'
			]
		};
		if (key === '2316') {
			return {
				key,
				title: `BIR 2316 data ${p.year}`,
				...common,
				sections: [
					{
						title: 'By employee',
						head: ['No.', 'Name', 'TIN', 'Gross compensation', 'Non-taxable', 'Taxable compensation', 'Tax due', 'Tax withheld', 'Over / (under) withheld', 'Address'],
						rows: rows.map((r) => [
							r.employeeNo,
							r.name,
							r.tin || '—',
							r.gross + r.benefits + r.prevTaxable,
							nonTaxable(r),
							r.taxable,
							r.taxDue,
							r.withheld + r.prevWithheld,
							r.withheld + r.prevWithheld - r.taxDue,
							r.address || '—'
						]),
						moneyCols: [3, 4, 5, 6, 7, 8],
						numCols: [3, 4, 5, 6, 7, 8]
					}
				]
			};
		}
		return {
			key,
			title: `BIR 1604-C alphalist ${p.year}`,
			...common,
			sections: [
				{
					title: 'Employees',
					head: ['Seq', 'TIN', 'Last name', 'First name', 'Middle name', 'Employed from', 'Employed to', 'Gross compensation', '13th month & benefits (exempt)', 'Exempt earnings', 'SSS, PhilHealth, Pag-IBIG', 'Total non-taxable', 'Taxable basic', 'Taxable 13th month & benefits', 'Total taxable', 'Tax due', 'Tax withheld', 'Over / (under) withheld', 'Substituted filing'],
					rows: rows.map((r, i) => [
						i + 1,
						r.tin || '—',
						r.lastName,
						r.firstName,
						r.middleName,
						r.hiredOn.slice(0, 4) === String(p.year) ? r.hiredOn : `${p.year}-01-01`,
						r.separatedOn && r.separatedOn.slice(0, 4) === String(p.year) ? r.separatedOn : `${p.year}-12-31`,
						r.gross + r.benefits,
						r.benefitsExempt,
						r.exemptEarnings,
						r.contributions,
						nonTaxable(r),
						r.basicTaxable,
						r.benefitsTaxable,
						r.taxable,
						r.taxDue,
						r.withheld + r.prevWithheld,
						r.withheld + r.prevWithheld - r.taxDue,
						r.prevTaxable === 0 ? 'Yes' : 'No'
					]),
					moneyCols: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
					numCols: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]
				}
			]
		};
	}

	if (key === '13th-month') {
		const r = await thirteenthMonthReport(organizationId, p.year);
		const REASON: Record<string, string> = {
			not_covered: 'Not entitled (managerial or marked not covered)',
			under_one_month: 'Under one month of service',
			nothing_earned: 'No basic pay on final payslips',
			paid_in_final_pay: 'Paid in final pay'
		};
		const STATUS = { paid: 'Paid', pending: 'Draft, not issued', excluded: 'Not paid', unpaid: 'Not yet paid' } as const;
		const sum = (f: (x: (typeof r.rows)[number]) => number) => r.rows.reduce((t, x) => t + f(x), 0);
		return {
			key,
			title: `13th month pay report ${p.year}`,
			period: `Calendar year ${p.year} · due on or before December 24, ${p.year}`,
			stats: [
				{ label: 'Employees listed', value: String(r.totals.people) },
				{ label: 'Employees paid', value: String(r.totals.paidPeople) },
				{ label: 'Total paid', value: '', money: true, raw: r.totals.paid },
				{ label: 'Not paid', value: String(r.totals.excludedPeople) },
				{ label: 'In draft', value: String(r.totals.pendingPeople) }
			],
			notes: [
				'One twelfth of basic salary actually earned in the year, from locked or released payslips. Overtime, premiums, night differential and allowances are not basic.',
				'Paid means issued: mid-year and year-end batches that are issued, plus the 13th month paid in final pay. A draft batch is shown as not yet issued.',
				'This is the internal report. Check the current DOLE form and filing date (generally January 15) before submitting.'
			],
			sections: [
				{
					title: 'By person',
					head: ['No.', 'Name', 'Establishment', 'Basic earned', 'Late / UT', '13th month due', 'Mid-year', 'Year-end', 'Final pay', 'Total paid', 'Status'],
					rows: [
						...r.rows.map((x) => [
							x.employeeNo,
							x.employeeName,
							x.establishment,
							x.basicEarned,
							x.late,
							x.entitled,
							x.paidMidYear,
							x.paidYearEnd,
							x.paidFinalPay,
							x.paid,
							x.status === 'excluded' && x.excludedReason
								? `${STATUS[x.status]}: ${REASON[x.excludedReason] ?? x.excludedReason}`
								: STATUS[x.status]
						]),
						...(r.rows.length > 0
							? [['', 'Total', '', sum((x) => x.basicEarned), sum((x) => x.late), r.totals.entitled, sum((x) => x.paidMidYear), sum((x) => x.paidYearEnd), sum((x) => x.paidFinalPay), r.totals.paid, '']]
							: [])
					],
					moneyCols: [3, 4, 5, 6, 7, 8, 9],
					numCols: [3, 4, 5, 6, 7, 8, 9]
				}
			]
		};
	}

	const t = await turnoverReport(organizationId, { from: p.from, to: p.to });
	const pct = (v: number | null) => (v === null ? '–' : `${v}%`);
	return {
		key: 'turnover',
		title: 'Turnover & attrition',
		period: `${date(p.from)} – ${date(p.to)}`,
		stats: [
			{ label: 'Separated', value: String(t.separated) },
			{ label: 'Voluntary', value: String(t.voluntary) },
			{ label: 'Involuntary', value: String(t.involuntary) },
			{ label: 'Turnover rate', value: pct(t.turnoverRatePct) },
			{ label: 'Retention rate', value: pct(t.retentionRatePct) },
			{ label: 'Average tenure', value: t.averageTenureYears === null ? '–' : `${t.averageTenureYears} yrs` }
		],
		notes: [
			`Headcount ${t.headcountStart} at the start and ${t.headcountEnd} at the end (average ${t.averageHeadcount}). Turnover = separations ÷ average headcount.`,
			'Voluntary = resigned or retired; involuntary = terminated or end of contract. There are no structured reason codes yet.'
		],
		sections: [
			{
				title: 'By kind',
				head: ['Kind', 'Voluntary', 'Separations'],
				rows: t.byKind.map((k) => [words(k.kind), k.voluntary ? 'Yes' : 'No', k.count]),
				numCols: [2]
			},
			{
				title: 'Who left',
				head: ['No.', 'Name', 'Kind', 'Voluntary', 'Hired', 'Last day', 'Years of service'],
				rows: t.people.map((x) => [x.employeeNo, x.name, words(x.kind), x.voluntary ? 'Yes' : 'No', x.hiredOn, x.lastDay, x.tenureYears]),
				numCols: [6]
			}
		]
	};
}
