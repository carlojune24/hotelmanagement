/** The reports Main HR can open from Reports. Add a report: one entry here plus a route folder under /reports. */
export const REPORTS = [
	{
		key: 'cost-centers',
		label: 'Cost by cost center',
		blurb: 'Payroll cost for a month by cost center, with the people and establishments behind each.'
	}
] as const;

export type ReportKey = (typeof REPORTS)[number]['key'];
