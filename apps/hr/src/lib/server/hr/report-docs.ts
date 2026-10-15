import { attendanceReport, headcountReport, payrollSummary, turnoverReport } from './internal-reports';
import { monthsWithPayroll } from './reports';

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
