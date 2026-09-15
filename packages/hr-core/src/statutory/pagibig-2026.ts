/**
 * Pag-IBIG contribution — placeholder. Per docs/standards/hr.md: 2% employee,
 * compensation cap ₱10,000 (max ₱200), employer matches. Verify against the
 * latest Pag-IBIG circular before go-live.
 */
export const PAGIBIG_2026_EFFECTIVE_DATE = '2026-01-01' as const;

export interface PagibigContribution {
	employeeShare: number;
	employerShare: number;
}

/** @throws Always — not yet implemented. */
export function computePagibig2026(_monthlyCompensationCentavos: number): PagibigContribution {
	throw new Error('Pag-IBIG 2026 contribution table not yet implemented — see docs/standards/hr.md');
}
