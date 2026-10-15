/** The reports Main HR can open from Reports. Add a report: one entry here plus a route folder under /reports. */
export const REPORTS = [
	{
		key: 'cost-centers',
		label: 'Cost by cost center',
		blurb: 'Payroll cost for a month by cost center, with the people and establishments behind each.'
	},
	{
		key: 'headcount',
		label: 'Headcount & demographics',
		blurb: 'Who is employed on a date: by establishment, department, type, sex, age and tenure.'
	},
	{
		key: 'payroll-summary',
		label: 'Payroll & compensation',
		blurb: 'Earnings, deductions, net pay and employer contributions from locked payslips.'
	},
	{
		key: 'attendance',
		label: 'Attendance & leave',
		blurb: 'Days worked, absences, late and undertime, overtime and leave taken, from saved DTRs.'
	},
	{
		key: '13th-month',
		label: '13th month pay',
		blurb: 'Per person for a year: 13th month due, paid mid-year, year-end and in final pay, and who was not paid. For the DOLE report.'
	},
	{
		key: 'data-completeness',
		label: 'Employee data completeness',
		blurb: 'Who is missing a TIN, agency number, address or bank account, before filing.'
	},
	{
		key: 'contributions-ytd',
		label: 'Contributions year to date',
		blurb: 'SSS, PhilHealth and Pag-IBIG employee and employer shares per person for the year.'
	},
	{
		key: 'payroll-variance',
		label: 'Payroll variance',
		blurb: 'Gross pay against the month before, per person, with unusual changes flagged.'
	},
	{
		key: 'loans-outstanding',
		label: 'Loans outstanding',
		blurb: 'Open loans with balance, behind schedule and end month, and who left owing.'
	},
	{
		key: '1601-c',
		label: 'BIR 1601-C monthly data',
		blurb: 'Per month: compensation, taxable pay, tax withheld, returned and what to remit, with due date and status.'
	},
	{
		key: 'contracts-due',
		label: 'Contracts and probation due',
		blurb: 'Contracts and probations ending soon or already ended without a replacement, so they can be regularized or renewed in time.'
	},
	{
		key: 'year-end-tax',
		label: 'Year-end tax',
		blurb: 'Income tax for the year against what was withheld, per employee, and what is still to withhold or return.'
	},
	{
		key: '2316',
		label: 'BIR 2316 data',
		blurb: 'Per employee for a year: compensation, non-taxable pay, taxable pay, tax due and tax withheld. Print each certificate from the list.'
	},
	{
		key: '1604-c',
		label: 'BIR 1604-C alphalist',
		blurb: 'The yearly alphalist of employees with compensation and tax withheld, as a table and CSV for the BIR alphalist data entry.'
	},
	{
		key: 'turnover',
		label: 'Turnover & attrition',
		blurb: 'Separations by kind, voluntary vs involuntary, turnover and retention rates, tenure.'
	}
] as const;

export type ReportKey = (typeof REPORTS)[number]['key'];
