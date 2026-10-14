import { RATES_IN_FORCE, getRun, listBatchLines } from './payroll';

/**
 * A payroll run shaped for the screens: the run page (every establishment) and the focus page
 * (one establishment) both read this, so the two can never disagree about a figure.
 */
export async function runView(runId: string) {
	const data = await getRun(runId);
	const lines = await Promise.all(data.batches.map(async (b) => [b.id, await listBatchLines(b.id)] as const));
	const byBatch = new Map(lines);
	const estName = new Map(data.batches.map((b) => [b.establishmentId, b.establishmentName]));

	return {
		run: {
			id: data.run.id,
			cutoffStart: data.run.cutoffStart,
			cutoffEnd: data.run.cutoffEnd,
			payDate: data.run.payDate,
			frequency: data.run.frequency,
			dayFactor: data.run.dayFactor,
			ratesCheckedAt: data.run.ratesCheckedAt
		},
		rates: RATES_IN_FORCE,
		batches: data.batches.map((b) => ({
			...b,
			lines: (byBatch.get(b.id) ?? []).map((l) => {
				const earnings = l.earnings as Record<string, number>;
				const deductions = l.deductions as Record<string, number>;
				const adj = l.adjustments as Record<string, number | null>;
				return {
					id: l.id,
					employeeName: l.employeeName,
					employeeNo: l.employeeNo,
					position: l.position,
					daysWorked: l.daysWorked,
					basic: earnings.basic ?? 0,
					overtime: earnings.overtime ?? 0,
					premium: (earnings.holiday_premium ?? 0) + (earnings.night_diff ?? 0),
					extras: (earnings.allowances ?? 0) + (earnings.other ?? 0),
					gross: l.grossCentavos,
					employer: Object.values((l.employerContributions ?? {}) as Record<string, number>).reduce((a, b) => a + b, 0),
					costCenter: ((l.detail as { costCenter?: { code: string; name: string } } | null)?.costCenter ?? null),
					sss: deductions.sss_ee ?? 0,
					philhealth: deductions.philhealth_ee ?? 0,
					pagibig: deductions.pagibig_ee ?? 0,
					tax: deductions.withholding_tax ?? 0,
					lateUndertime: deductions.tardiness_undertime ?? 0,
					loanDeductions: deductions.loans ?? 0,
					cashAdvance: deductions.cash_advance ?? 0,
					otherDeductions: deductions.other ?? 0,
					net: l.netPayCentavos,
					payItems: ((l.detail as { payItems?: Array<{ id: string; kind: string; label: string; amountCentavos: number }> } | null)?.payItems ?? []),
					loans: ((l.detail as { loans?: Array<{ label: string; due: number; deducted: number }> } | null)?.loans ?? []).map(
						(x) => ({ label: x.label, due: x.due, deducted: x.deducted })
					),
					sharedWith: Object.keys(l.costByEstablishment as Record<string, number>)
						.filter((id) => id !== l.establishmentId)
						.map((id) => estName.get(id) ?? 'another establishment'),
					adjustments: {
						allowances: (adj.allowancesCentavos ?? 0) / 100,
						otherEarnings: (adj.otherEarningsCentavos ?? 0) / 100,
						cashAdvance: (adj.cashAdvanceCentavos ?? 0) / 100,
						otherDeductions: (adj.otherDeductionsCentavos ?? 0) / 100,
						withholdingOverride: adj.withholdingOverrideCentavos == null ? '' : String((adj.withholdingOverrideCentavos as number) / 100)
					}
				};
			})
		}))
	};
}

export type RunView = Awaited<ReturnType<typeof runView>>;
export type BatchView = RunView['batches'][number];
export type LineView = BatchView['lines'][number];
