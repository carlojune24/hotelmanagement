/**
 * BIR withholding tax (TRAIN law) — placeholder. Per docs/standards/hr.md:
 * daily/weekly/semi-monthly/monthly brackets, first bracket 0%, then 15%–35%,
 * annualised true-up at year-end. Bracket tables not yet filled in — verify
 * against the latest BIR RMC before go-live.
 */
export const BIR_TRAIN_EFFECTIVE_DATE = '2023-01-01' as const;

export type PayFrequency = 'daily' | 'weekly' | 'semi_monthly' | 'monthly';

/** @throws Always — bracket tables not yet implemented. */
export function computeWithholdingTax(
	_taxableIncomeCentavos: number,
	_frequency: PayFrequency
): number {
	throw new Error('BIR TRAIN withholding brackets not yet implemented — see docs/standards/hr.md');
}
