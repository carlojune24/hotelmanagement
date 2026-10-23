import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { annualTaxDue } from '@mm/hr-core';
import { db } from '$lib/server/db/index';
import {
	bonusBatches,
	bonusLines,
	employees,
	payrollBatches,
	payrollRunLines,
	payrollRuns,
	separationItems,
	separations
} from '$lib/server/db/schema/index';
import { TAX_EXEMPT_CENTAVOS } from './thirteenth-month';
import { PayrollError, adjustLine } from './payroll';

/**
 * Year-end annualization: the whole year's income tax on what a person earned, settled against what was
 * withheld period by period. Figures are centavos. The draft batch an adjustment is being worked out for is
 * counted too (as `target`), so the settlement includes its own pay and withholding.
 *
 * Simplifications, deliberate: income is taken from payslips by pay date year; a person's 13th month and
 * other benefits are exempt up to ₱90,000 and the excess is taxable; no deductions beyond the employee
 * SSS / PhilHealth / Pag-IBIG shares and exempt earnings are modelled (no personal exemptions under TRAIN).
 */
export interface AnnualRow {
	employeeId: string;
	employeeNo: string;
	name: string;
	lastName: string;
	firstName: string;
	middleName: string;
	tin: string;
	address: string;
	birthdate: string;
	hiredOn: string;
	separatedOn: string | null;
	status: string;
	withholdingExempt: boolean;
	payslips: number;
	gross: number;
	/** Earnings exempt from income tax (de minimis and similar). */
	exemptEarnings: number;
	contributions: number;
	/** 13th month and other benefits paid in the year (bonus batches issued + 13th month in final pay). */
	benefits: number;
	benefitsExempt: number;
	benefitsTaxable: number;
	prevTaxable: number;
	prevWithheld: number;
	prevEmployerName: string;
	taxable: number;
	taxDue: number;
	/** Withheld by this employer so far, net of anything already returned. */
	withheld: number;
	/** Already on a line as an annualization settlement (positive withheld, negative returned). */
	applied: number;
	/** What is still to withhold (positive) or return (negative). */
	settlement: number;
	/** The settlement already written on this person's draft line in the target batches. */
	appliedInDraft: number;
	/** Bonus Jan–Nov style split is not tracked; kept for the alphalist's December column. */
	basicTaxable: number;
}

interface LineRow {
	employeeId: string;
	gross: number;
	deductions: Record<string, number>;
	detail: { nonTaxableCentavos?: number; annualTaxAdjustmentCentavos?: number; regularWithholdingCentavos?: number };
	batchId: string;
	batchStatus: string;
}

export async function annualizationRows(
	organizationId: string,
	year: number,
	target: { batchId: string } | { batchIds: string[] } | null = null
): Promise<AnnualRow[]> {
	const targetIds = !target ? [] : 'batchId' in target ? [target.batchId] : target.batchIds;
	const yearStart = `${year}-01-01`;
	const yearEnd = `${year}-12-31`;
	const lineRows = await db
		.select({
			employeeId: payrollRunLines.employeeId,
			gross: payrollRunLines.grossCentavos,
			deductions: payrollRunLines.deductions,
			detail: payrollRunLines.detail,
			batchId: payrollBatches.id,
			batchStatus: payrollBatches.status
		})
		.from(payrollRunLines)
		.innerJoin(payrollBatches, eq(payrollBatches.id, payrollRunLines.batchId))
		.innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunLines.runId))
		.where(
			and(
				eq(payrollRuns.organizationId, organizationId),
				sql`${payrollRuns.payDate} between ${yearStart} and ${yearEnd}`,
				targetIds.length
					? or(inArray(payrollBatches.status, ['locked', 'released']), inArray(payrollBatches.id, targetIds))
					: inArray(payrollBatches.status, ['locked', 'released'])
			)
		);
	const lines = lineRows as unknown as LineRow[];
	const ids = [...new Set(lines.map((l) => l.employeeId))];

	const people = await db
		.select()
		.from(employees)
		.where(
			and(
				eq(employees.organizationId, organizationId),
				isNull(employees.deletedAt),
				or(ids.length ? inArray(employees.id, ids) : sql`false`, eq(employees.prevEmployerYear, year))
			)
		);
	const allIds = people.map((p) => p.id);
	const bonusRows = allIds.length
		? await db
				.select({ employeeId: bonusLines.employeeId, total: sql<number>`coalesce(sum(${bonusLines.amountCentavos}), 0)::bigint` })
				.from(bonusLines)
				.innerJoin(bonusBatches, eq(bonusBatches.id, bonusLines.batchId))
				.where(and(inArray(bonusLines.employeeId, allIds), eq(bonusBatches.year, year), eq(bonusBatches.status, 'issued')))
				.groupBy(bonusLines.employeeId)
		: [];
	const finalRows = allIds.length
		? await db
				.select({ employeeId: separations.employeeId, total: sql<number>`coalesce(sum(${separationItems.amountCentavos}), 0)::bigint` })
				.from(separationItems)
				.innerJoin(separations, eq(separations.id, separationItems.separationId))
				.where(
					and(
						inArray(separations.employeeId, allIds),
						eq(separationItems.source, 'thirteenth_month'),
						eq(separationItems.sourceYear, year),
						isNull(separationItems.voidedAt)
					)
				)
				.groupBy(separations.employeeId)
		: [];
	const bonusOf = new Map(bonusRows.map((r) => [r.employeeId, Number(r.total)]));
	const finalOf = new Map(finalRows.map((r) => [r.employeeId, Number(r.total)]));

	const rows = people.map((p): AnnualRow => {
		const mine = lines.filter((l) => l.employeeId === p.id);
		let gross = 0;
		let exemptEarnings = 0;
		let contributions = 0;
		let withheld = 0;
		let returned = 0;
		let applied = 0;
		let appliedInDraft = 0;
		for (const l of mine) {
			const ded = l.deductions ?? {};
			const adj = l.detail?.annualTaxAdjustmentCentavos ?? 0;
			const isTarget = targetIds.includes(l.batchId);
			gross += Number(l.gross);
			exemptEarnings += l.detail?.nonTaxableCentavos ?? 0;
			contributions += (ded.sss_ee ?? 0) + (ded.philhealth_ee ?? 0) + (ded.pagibig_ee ?? 0);
			// The target's own settlement is what is being recomputed, so it is taken back out.
			const wh = (ded.withholding_tax ?? 0) - (isTarget ? Math.max(0, adj) : 0);
			withheld += wh;
			if (adj < 0 && !isTarget) returned += -adj;
			if (!isTarget) applied += adj;
			if (isTarget) appliedInDraft += adj;
			if (isTarget && adj < 0) {
				// A returned refund sits in gross and exempt earnings; take it out so it is not counted as income.
				gross -= -adj;
				exemptEarnings -= -adj;
			}
		}
		const benefits = (bonusOf.get(p.id) ?? 0) + (finalOf.get(p.id) ?? 0);
		const benefitsExempt = Math.min(benefits, TAX_EXEMPT_CENTAVOS);
		const benefitsTaxable = benefits - benefitsExempt;
		const prev = p.prevEmployerYear === year;
		const prevTaxable = prev ? p.prevEmployerTaxableCentavos : 0;
		const prevWithheld = prev ? p.prevEmployerWithheldCentavos : 0;
		const basicTaxable = Math.max(0, gross - exemptEarnings - contributions);
		const taxable = basicTaxable + benefitsTaxable + prevTaxable;
		const taxDue = p.withholdingExempt ? 0 : annualTaxDue(taxable);
		const netWithheld = withheld - returned;
		const gov = (p.govIds ?? {}) as { tin?: string };
		return {
			employeeId: p.id,
			employeeNo: p.employeeNo,
			name: `${p.lastName}, ${p.firstName}`,
			lastName: p.lastName,
			firstName: p.firstName,
			middleName: p.middleName ?? '',
			tin: gov.tin ?? '',
			address: p.address ?? '',
			birthdate: p.birthdate,
			hiredOn: p.hiredOn,
			separatedOn: p.separatedOn,
			status: p.status,
			withholdingExempt: p.withholdingExempt,
			payslips: mine.length,
			gross,
			exemptEarnings,
			contributions,
			benefits,
			benefitsExempt,
			benefitsTaxable,
			prevTaxable,
			prevWithheld,
			prevEmployerName: prev ? (p.prevEmployerName ?? '') : '',
			taxable,
			taxDue,
			withheld: netWithheld,
			applied,
			appliedInDraft,
			// Per-period tables are rounded to the peso, so a few centavos either way is noise, not a settlement.
			settlement: Math.abs(taxDue - netWithheld - prevWithheld) < 100 ? 0 : taxDue - netWithheld - prevWithheld,
			basicTaxable
		};
	});
	return rows.filter((r) => r.payslips > 0 || r.prevTaxable > 0).sort((a, b) => a.name.localeCompare(b.name));
}

/** The year's draft batches (paid in `year`), so figures can be shown as the year will stand once they are final. */
export async function draftBatchIdsForYear(organizationId: string, year: number): Promise<string[]> {
	const rows = await db
		.select({ id: payrollBatches.id })
		.from(payrollBatches)
		.innerJoin(payrollRuns, eq(payrollRuns.id, payrollBatches.runId))
		.where(
			and(
				eq(payrollRuns.organizationId, organizationId),
				eq(payrollBatches.status, 'draft'),
				sql`${payrollRuns.payDate} between ${`${year}-01-01`} and ${`${year}-12-31`}`
			)
		);
	return rows.map((r) => r.id);
}

/**
 * Writes each person's settlement onto their line in one draft batch (the year's last payroll). A person
 * with no line in that batch is returned as `missing`, since there is nowhere to put it. Re-running recomputes
 * from scratch, so it is safe to repeat after the batch is regenerated.
 */
export async function applyAnnualization(organizationId: string, year: number, batchId: string) {
	const batch = await db
		.select({ b: payrollBatches, run: payrollRuns })
		.from(payrollBatches)
		.innerJoin(payrollRuns, eq(payrollRuns.id, payrollBatches.runId))
		.where(and(eq(payrollBatches.id, batchId), eq(payrollRuns.organizationId, organizationId)))
		.then((r) => r.at(0));
	if (!batch) throw new PayrollError('That payroll batch does not exist.');
	if (batch.b.status !== 'draft') throw new PayrollError('Only a draft batch can take the year-end settlement. Unlock it first.');
	if (!batch.run.payDate.startsWith(String(year))) throw new PayrollError(`That batch is not paid in ${year}.`);

	const lines = await db
		.select({ id: payrollRunLines.id, employeeId: payrollRunLines.employeeId, adjustments: payrollRunLines.adjustments })
		.from(payrollRunLines)
		.where(eq(payrollRunLines.batchId, batchId));
	const overrideOf = (adjustments: unknown) => {
		const kept = (adjustments ?? {}) as { withholdingOverrideCentavos?: number | null };
		return kept.withholdingOverrideCentavos == null ? null : kept.withholdingOverrideCentavos / 100;
	};
	// Clear any earlier settlement first: it also re-prices the regular withholding from the line as it is now,
	// so the settlement below is measured against exactly what the line will withhold.
	for (const l of lines) {
		await adjustLine({ lineId: l.id, annualTaxAdjustment: 0, withholdingOverride: overrideOf(l.adjustments) });
	}
	const rows = await annualizationRows(organizationId, year, { batchId });
	const lineOf = new Map(lines.map((l) => [l.employeeId, l]));
	let applied = 0;
	const missing: string[] = [];
	for (const r of rows) {
		const line = lineOf.get(r.employeeId);
		if (!line) {
			if (r.settlement !== 0 && r.status !== 'separated') missing.push(r.name);
			continue;
		}
		await adjustLine({
			lineId: line.id,
			annualTaxAdjustment: r.settlement / 100,
			withholdingOverride: overrideOf(line.adjustments)
		});
		if (r.settlement !== 0) applied += 1;
	}
	return { applied, missing };
}
