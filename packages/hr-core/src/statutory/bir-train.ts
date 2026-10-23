/**
 * BIR withholding tax on compensation — the TRAIN law (RA 10963) schedule effective 2023 onward,
 * applied per pay period. Annual rate table: 0% to ₱250,000; 15% to ₱400,000; 20% to ₱800,000;
 * 25% to ₱2,000,000; 30% to ₱8,000,000; 35% above.
 *
 * The published per-period tables are those annual bounds divided by the number of periods and
 * rounded to the peso, with each bracket's fixed amount accumulated from those rounded bounds
 * (monthly: ₱20,833 / 33,333 / 66,667 / 166,667 / 666,667 with fixed ₱1,875 / 8,541.80 /
 * 33,541.80 / 183,541.80). This builds them the same way, so the figures match the BIR tables.
 *
 * Taxable compensation is gross pay less the employee's mandatory SSS/PhilHealth/Pag-IBIG shares.
 * There is no year-end annualised true-up here.
 *
 * ⚠ Encoded from the 2023 schedule; NOT verified against a later revenue regulation — Main HR
 * confirms it at each lock. All amounts are integer centavos.
 */
export const BIR_TRAIN_EFFECTIVE_DATE = '2023-01-01' as const;

export type PayFrequency = 'daily' | 'weekly' | 'semi_monthly' | 'monthly';

/** Annual upper bounds in pesos and the rate that applies *above the previous bound*. */
const ANNUAL: ReadonlyArray<{ upTo: number; rate: number }> = [
	{ upTo: 250_000, rate: 0 },
	{ upTo: 400_000, rate: 0.15 },
	{ upTo: 800_000, rate: 0.2 },
	{ upTo: 2_000_000, rate: 0.25 },
	{ upTo: 8_000_000, rate: 0.3 },
	{ upTo: Infinity, rate: 0.35 }
];

const PERIODS: Record<PayFrequency, number> = { daily: 365, weekly: 52, semi_monthly: 24, monthly: 12 };

export interface WithholdingBracket {
	/** Lower bound (peso) of the bracket. */
	over: number;
	/** Fixed tax (peso) at the lower bound. */
	base: number;
	/** Rate on the excess over `over`. */
	rate: number;
}

/** The per-period table for a frequency, built from the annual brackets. */
export function withholdingTable(frequency: PayFrequency): WithholdingBracket[] {
	const n = PERIODS[frequency];
	const out: WithholdingBracket[] = [];
	let lower = 0;
	let base = 0;
	for (let i = 0; i < ANNUAL.length; i++) {
		const { rate } = ANNUAL[i]!;
		out.push({ over: lower, base: Math.round(base * 100) / 100, rate });
		const upper = ANNUAL[i]!.upTo === Infinity ? Infinity : Math.round(ANNUAL[i]!.upTo / n);
		if (upper !== Infinity) base += rate * (upper - lower);
		lower = upper;
	}
	return out;
}

/** Tax to withhold on `taxableIncomeCentavos` earned in one pay period of `frequency`. */
export function computeWithholdingTax(taxableIncomeCentavos: number, frequency: PayFrequency): number {
	const pesos = Math.max(0, taxableIncomeCentavos) / 100;
	const table = withholdingTable(frequency);
	let bracket = table[0]!;
	for (const b of table) if (pesos > b.over) bracket = b;
	if (bracket.rate === 0) return 0;
	return Math.round((bracket.base + bracket.rate * (pesos - bracket.over)) * 100);
}

/**
 * The year's income tax on an annual taxable compensation (TRAIN annual table), in centavos. This is the
 * figure year-end annualization settles the per-period withholding against.
 */
export function annualTaxDue(annualTaxableCentavos: number): number {
	const income = Math.max(0, annualTaxableCentavos) / 100;
	let tax = 0;
	let lower = 0;
	for (const { upTo, rate } of ANNUAL) {
		if (income > lower) tax += rate * (Math.min(income, upTo) - lower);
		if (income <= upTo) break;
		lower = upTo;
	}
	return Math.round(tax * 100);
}
