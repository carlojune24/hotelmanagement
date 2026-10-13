/**
 * SSS contribution — the 15% schedule (Republic Act 11199): employer 10%, employee 5% of the
 * Monthly Salary Credit (MSC), MSC from ₱5,000 to ₱35,000 in ₱500 steps, plus the employer-paid
 * EC of ₱10 (MSC below ₱15,000) or ₱30 (₱15,000 and up).
 *
 * The MSC is a plain function of monthly compensation: round to the nearest ₱500, clamped to
 * the range (so ₱5,250–₱5,749.99 → ₱5,500, and ₱34,750 and above → ₱35,000). The regular-SS /
 * MPF (WISP) split of the MSC changes where the money is credited, not what is withheld, so it
 * is not modelled here.
 *
 * ⚠ Rates and brackets are encoded from the published schedule in force since January 2025 and
 * have NOT been verified against the 2026 SSS circular — Main HR confirms them at each lock.
 * All amounts are integer centavos.
 */
export const SSS_2026_EFFECTIVE_DATE = '2026-01-01' as const;
/** The schedule these figures come from (no further step-up was scheduled after it). */
export const SSS_SCHEDULE_IN_FORCE_SINCE = '2025-01-01' as const;

export const SSS_MSC_MIN_CENTAVOS = 500_000;
export const SSS_MSC_MAX_CENTAVOS = 3_500_000;
const MSC_STEP = 50_000;

export interface SssContribution {
	employeeShare: number;
	employerShare: number;
	ec: number;
}

/** Monthly Salary Credit (centavos) for a month's compensation (centavos). */
export function sssMonthlySalaryCredit(monthlyCompensationCentavos: number): number {
	const stepped = Math.floor((Math.max(0, monthlyCompensationCentavos) + MSC_STEP / 2) / MSC_STEP) * MSC_STEP;
	return Math.min(SSS_MSC_MAX_CENTAVOS, Math.max(SSS_MSC_MIN_CENTAVOS, stepped));
}

/** A month's SSS contribution for `monthlySalaryCreditCentavos` of monthly compensation. */
export function computeSss2026(monthlySalaryCreditCentavos: number): SssContribution {
	const msc = sssMonthlySalaryCredit(monthlySalaryCreditCentavos);
	return {
		employeeShare: Math.round(msc * 0.05),
		employerShare: Math.round(msc * 0.1),
		ec: msc < 1_500_000 ? 1_000 : 3_000
	};
}
