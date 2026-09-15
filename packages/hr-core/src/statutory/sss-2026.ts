/**
 * SSS contribution table — placeholder. Per docs/standards/hr.md: 2026 circular,
 * 15% of Monthly Salary Credit (MSC ₱5,000–₱35,000), employee share 5%, plus EC.
 * Bracket table not yet filled in — verify against the latest SSS circular before
 * go-live.
 */
export const SSS_2026_EFFECTIVE_DATE = '2026-01-01' as const;

export interface SssContribution {
	employeeShare: number;
	employerShare: number;
	ec: number;
}

/** @throws Always — bracket table not yet implemented. */
export function computeSss2026(_monthlySalaryCreditCentavos: number): SssContribution {
	throw new Error('SSS 2026 bracket table not yet implemented — see docs/standards/hr.md');
}
