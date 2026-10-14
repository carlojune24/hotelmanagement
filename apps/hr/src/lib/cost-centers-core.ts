/** Pure grouping of payslip lines by cost center, shared by the run page, the register print and tests. */

export interface CostLine {
	costCenter: { code: string; name: string } | null;
	gross: number;
	/** Employer-side contributions (SSS, PhilHealth, Pag-IBIG, ECC) on top of gross. */
	employer: number;
}

export interface CostCenterRow {
	code: string | null;
	name: string;
	people: number;
	gross: number;
	employer: number;
	total: number;
}

/** Sorted by code, with people who have none kept as "Unassigned" last so totals always reconcile. */
export function groupByCostCenter(lines: CostLine[]): CostCenterRow[] {
	const by = new Map<string, CostCenterRow>();
	for (const l of lines) {
		const key = l.costCenter?.code ?? '';
		const row = by.get(key) ?? {
			code: l.costCenter?.code ?? null,
			name: l.costCenter?.name ?? 'Unassigned',
			people: 0,
			gross: 0,
			employer: 0,
			total: 0
		};
		row.people += 1;
		row.gross += l.gross;
		row.employer += l.employer;
		row.total = row.gross + row.employer;
		by.set(key, row);
	}
	return [...by.values()].sort((a, b) => (a.code === null ? 1 : b.code === null ? -1 : a.code.localeCompare(b.code)));
}
