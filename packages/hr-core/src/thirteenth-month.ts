/**
 * 13th-month pay accrual — placeholder. Philippine statutory 13th-month pay is
 * 1/12 of total basic salary earned within the calendar year, accrued per payroll
 * run (`payrollRunLine.thirteenth_month_accrual`) and typically released by
 * December 24. Real accrual logic is a dedicated follow-up.
 */

/** @throws Always — not yet implemented. */
export function accrueThirteenthMonth(
	_basicEarnedThisRunCentavos: number
): number {
	throw new Error('13th-month accrual not yet implemented — see docs/standards/hr.md');
}
