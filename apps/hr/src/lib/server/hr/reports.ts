import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { establishments, payrollBatches, payrollRunLines, payrollRuns } from '$lib/server/db/schema/index';
import { groupByCostCenter, type CostCenterRow } from '$lib/cost-centers-core';

export interface CostReportPerson {
	employeeId: string;
	employeeNo: string;
	name: string;
	establishment: string;
	gross: number;
	employer: number;
	total: number;
	payslips: number;
}

export interface CostReportCenter extends CostCenterRow {
	persons: CostReportPerson[];
	establishments: Array<{ name: string; people: number; gross: number; employer: number; total: number }>;
}

export interface CostReport {
	month: string;
	centers: CostReportCenter[];
	totals: { people: number; gross: number; employer: number; total: number };
	/** Payslip lines still in a draft batch that were counted (only when drafts are included). */
	draftLines: number;
	lines: number;
}

/**
 * Cost by cost center for one month: every payslip line whose run's cutoff ends in the month, summed per
 * person (a semi-monthly person has two lines), then grouped by the cost center frozen on the line.
 * Locked and released payslips only, unless `includeDrafts`.
 */
export async function costCenterReport(
	organizationId: string,
	opts: { month: string; establishmentId?: string | null; includeDrafts?: boolean }
): Promise<CostReport> {
	const start = `${opts.month}-01`;
	const [y, m] = opts.month.split('-').map(Number);
	const end = `${opts.month}-${String(new Date(Date.UTC(y!, m!, 0)).getUTCDate()).padStart(2, '0')}`;
	const rows = await db
		.select({
			line: payrollRunLines,
			status: payrollBatches.status,
			estName: establishments.name
		})
		.from(payrollRunLines)
		.innerJoin(payrollBatches, eq(payrollBatches.id, payrollRunLines.batchId))
		.innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunLines.runId))
		.innerJoin(establishments, eq(establishments.id, payrollRunLines.establishmentId))
		.where(
			and(
				eq(payrollRuns.organizationId, organizationId),
				gte(payrollRuns.cutoffEnd, start),
				lte(payrollRuns.cutoffEnd, end),
				opts.includeDrafts ? undefined : inArray(payrollBatches.status, ['locked', 'released']),
				opts.establishmentId ? eq(payrollRunLines.establishmentId, opts.establishmentId) : undefined
			)
		);

	const per = new Map<string, CostReportPerson & { costCenter: { code: string; name: string } | null }>();
	let draftLines = 0;
	for (const r of rows) {
		if (r.status === 'draft') draftLines++;
		const cc = (r.line.detail as { costCenter?: { code: string; name: string } } | null)?.costCenter ?? null;
		const employer = Object.values((r.line.employerContributions ?? {}) as Record<string, number>).reduce((a, b) => a + b, 0);
		const key = `${r.line.employeeId}|${cc?.code ?? ''}`;
		const cur = per.get(key) ?? {
			employeeId: r.line.employeeId,
			employeeNo: r.line.employeeNo,
			name: r.line.employeeName,
			establishment: r.estName,
			gross: 0,
			employer: 0,
			total: 0,
			payslips: 0,
			costCenter: cc
		};
		cur.gross += r.line.grossCentavos;
		cur.employer += employer;
		cur.total = cur.gross + cur.employer;
		cur.payslips += 1;
		per.set(key, cur);
	}

	const people = [...per.values()];
	const grouped = groupByCostCenter(people.map((p) => ({ costCenter: p.costCenter, gross: p.gross, employer: p.employer })));
	const centers: CostReportCenter[] = grouped.map((g) => {
		const persons = people
			.filter((p) => (p.costCenter?.code ?? null) === g.code)
			.sort((a, b) => a.name.localeCompare(b.name))
			.map(({ costCenter: _c, ...rest }) => rest);
		const byEst = new Map<string, { name: string; people: number; gross: number; employer: number; total: number }>();
		for (const p of persons) {
			const e = byEst.get(p.establishment) ?? { name: p.establishment, people: 0, gross: 0, employer: 0, total: 0 };
			e.people += 1;
			e.gross += p.gross;
			e.employer += p.employer;
			e.total += p.total;
			byEst.set(p.establishment, e);
		}
		return { ...g, persons, establishments: [...byEst.values()].sort((a, b) => a.name.localeCompare(b.name)) };
	});
	return {
		month: opts.month,
		centers,
		totals: {
			people: centers.reduce((a, c) => a + c.people, 0),
			gross: centers.reduce((a, c) => a + c.gross, 0),
			employer: centers.reduce((a, c) => a + c.employer, 0),
			total: centers.reduce((a, c) => a + c.total, 0)
		},
		draftLines,
		lines: rows.length
	};
}

/** The months that have payroll, newest first, so the picker can start on one with data. */
export async function monthsWithPayroll(organizationId: string): Promise<string[]> {
	const rows = await db
		.select({ end: payrollRuns.cutoffEnd })
		.from(payrollRuns)
		.where(eq(payrollRuns.organizationId, organizationId));
	return [...new Set(rows.map((r) => r.end.slice(0, 7)))].sort().reverse();
}

export function costReportCsv(report: CostReport): string {
	const peso = (c: number) => (c / 100).toFixed(2);
	const q = (v: string) => `"${v.replaceAll('"', '""')}"`;
	const head = ['month', 'cost_center_code', 'cost_center', 'employee_no', 'employee', 'establishment', 'payslips', 'gross', 'employer', 'total'];
	const lines = [head.join(',')];
	for (const c of report.centers) {
		for (const p of c.persons) {
			lines.push(
				[report.month, q(c.code ?? ''), q(c.name), q(p.employeeNo), q(p.name), q(p.establishment), p.payslips, peso(p.gross), peso(p.employer), peso(p.total)].join(',')
			);
		}
	}
	return lines.join('\r\n') + '\r\n';
}
