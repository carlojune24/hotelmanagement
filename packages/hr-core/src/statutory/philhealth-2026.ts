/**
 * PhilHealth premium — 5% of the monthly basic salary (Universal Health Care Act), with a basic
 * salary floor of ₱10,000 and ceiling of ₱100,000 (premium ₱500–₱5,000), shared equally by the
 * employee and the employer.
 *
 * ⚠ Rate and bounds are encoded from the published schedule in force since 2024 and have NOT
 * been verified against the 2026 PhilHealth advisory — Main HR confirms them at each lock.
 * All amounts are integer centavos.
 */
export const PHILHEALTH_2026_EFFECTIVE_DATE = '2026-01-01' as const;

export const PHILHEALTH_FLOOR_CENTAVOS = 1_000_000;
export const PHILHEALTH_CEILING_CENTAVOS = 10_000_000;

export interface PhilhealthContribution {
	employeeShare: number;
	employerShare: number;
}

/** A month's PhilHealth premium for `monthlyCompensationCentavos` of monthly basic salary. */
export function computePhilhealth2026(monthlyCompensationCentavos: number): PhilhealthContribution {
	const base = Math.min(
		PHILHEALTH_CEILING_CENTAVOS,
		Math.max(PHILHEALTH_FLOOR_CENTAVOS, monthlyCompensationCentavos)
	);
	const total = Math.round(base * 0.05);
	const employeeShare = Math.floor(total / 2);
	return { employeeShare, employerShare: total - employeeShare };
}
