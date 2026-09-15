import type { PayrollRunLine } from './index';

/**
 * Payroll-line computation — placeholder. Composes gross (basic + OT + holiday
 * premium + night diff + allowances), less absences/tardiness, statutory
 * deductions (see ./statutory/*), BIR withholding, net pay — per
 * docs/standards/hr.md's payroll-run line shape. Real computation is a
 * dedicated follow-up; this only fixes the function's shape.
 */
export interface ComputePayrollLineInput {
	personRef: string;
	costCenter: string | null;
	daysWorked: number;
	hoursRegular: number;
	hoursOt: number;
	hoursNightDiff: number;
	baseRateCentavos: number;
	cashAdvanceDeductionCentavos: number;
}

/** @throws Always — not yet implemented. */
export function computePayrollLine(_input: ComputePayrollLineInput): PayrollRunLine {
	throw new Error('Payroll-line computation not yet implemented — see docs/standards/hr.md');
}
