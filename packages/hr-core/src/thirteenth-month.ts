/**
 * 13th-month pay accrual: one twelfth of the basic salary actually earned in the calendar year
 * (Presidential Decree 851), accrued per payroll run and released by December 24. Only basic pay
 * counts — overtime, premiums, allowances and night differential do not — so the input is the
 * basic earned in the run, after absences, late and undertime.
 */
export function accrueThirteenthMonth(basicEarnedThisRunCentavos: number): number {
	return Math.round(Math.max(0, basicEarnedThisRunCentavos) / 12);
}
