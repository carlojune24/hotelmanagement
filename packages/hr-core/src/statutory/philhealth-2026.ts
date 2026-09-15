/**
 * PhilHealth premium — placeholder. Per docs/standards/hr.md: 5% premium, floor
 * ₱500 / ceiling ₱5,000 monthly, split 50/50 employee/employer. Verify against the
 * latest PhilHealth advisory before go-live.
 */
export const PHILHEALTH_2026_EFFECTIVE_DATE = '2026-01-01' as const;

export interface PhilhealthContribution {
	employeeShare: number;
	employerShare: number;
}

/** @throws Always — not yet implemented. */
export function computePhilhealth2026(_monthlyCompensationCentavos: number): PhilhealthContribution {
	throw new Error('PhilHealth 2026 premium table not yet implemented — see docs/standards/hr.md');
}
