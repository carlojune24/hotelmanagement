/**
 * Pag-IBIG (HDMF) contribution — employee 2% and employer 2% of monthly compensation, capped at a
 * maximum fund salary of ₱10,000 (so at most ₱200 each). Compensation of ₱1,500 or less pays
 * 1% employee / 2% employer.
 *
 * ⚠ Rates and the cap are encoded from the circular in force since February 2024 and have NOT
 * been verified against a 2026 circular — Main HR confirms them at each lock.
 * All amounts are integer centavos.
 */
export const PAGIBIG_2026_EFFECTIVE_DATE = '2026-01-01' as const;

export const PAGIBIG_MAX_FUND_SALARY_CENTAVOS = 1_000_000;
const LOW_COMPENSATION_CENTAVOS = 150_000;

export interface PagibigContribution {
	employeeShare: number;
	employerShare: number;
}

/** A month's Pag-IBIG contribution for `monthlyCompensationCentavos`. */
export function computePagibig2026(monthlyCompensationCentavos: number): PagibigContribution {
	const comp = Math.max(0, monthlyCompensationCentavos);
	const base = Math.min(PAGIBIG_MAX_FUND_SALARY_CENTAVOS, comp);
	const employeeRate = comp <= LOW_COMPENSATION_CENTAVOS ? 0.01 : 0.02;
	return {
		employeeShare: Math.round(base * employeeRate),
		employerShare: Math.round(base * 0.02)
	};
}
