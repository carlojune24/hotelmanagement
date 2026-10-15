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
		key: 'turnover',
		label: 'Turnover & attrition',
		blurb: 'Separations by kind, voluntary vs involuntary, turnover and retention rates, tenure.'
	}
] as const;

export type ReportKey = (typeof REPORTS)[number]['key'];
