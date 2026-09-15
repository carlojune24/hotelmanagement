import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { computePayrollLine } from '@mm/hr-core';
import { db } from '$lib/server/db/index';
import { employees, payrollRunLines, payrollRuns } from '$lib/server/db/schema/index';

export const payrollRunFormSchema = z.object({
	cutoffStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	cutoffEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	payDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});
export type PayrollRunFormInput = z.infer<typeof payrollRunFormSchema>;

export async function listPayrollRuns(hotelId: string) {
	return db.select().from(payrollRuns).where(eq(payrollRuns.hotelId, hotelId)).orderBy(desc(payrollRuns.cutoffStart));
}

export async function getPayrollRun(hotelId: string, id: string) {
	return db
		.select()
		.from(payrollRuns)
		.where(and(eq(payrollRuns.hotelId, hotelId), eq(payrollRuns.id, id)))
		.then((r) => r.at(0) ?? null);
}

export async function getPayrollRunLines(runId: string) {
	return db
		.select({
			id: payrollRunLines.id,
			employeeId: payrollRunLines.employeeId,
			employeeName: employees.firstName,
			employeeLastName: employees.lastName,
			daysWorked: payrollRunLines.daysWorked,
			grossCentavos: payrollRunLines.grossCentavos,
			deductions: payrollRunLines.deductions,
			netPayCentavos: payrollRunLines.netPayCentavos
		})
		.from(payrollRunLines)
		.innerJoin(employees, eq(employees.id, payrollRunLines.employeeId))
		.where(eq(payrollRunLines.payrollRunId, runId))
		.orderBy(asc(employees.lastName));
}

export async function createPayrollRun(hotelId: string, input: PayrollRunFormInput) {
	const [row] = await db
		.insert(payrollRuns)
		.values({ hotelId, cutoffStart: input.cutoffStart, cutoffEnd: input.cutoffEnd, payDate: input.payDate })
		.returning();
	return row!;
}

/**
 * Generates this run's per-employee lines by calling `@mm/hr-core`'s `computePayrollLine`
 * for every active employee at this hotel. That function is currently a stub (statutory
 * bracket tables aren't filled in — see docs/standards/hr.md) and always throws; this
 * surfaces that clearly rather than writing zeroed/fabricated payroll numbers.
 */
export async function generatePayrollRunLines(hotelId: string, runId: string): Promise<never> {
	const activeEmployees = await db
		.select({ id: employees.id })
		.from(employees)
		.where(and(eq(employees.hotelId, hotelId), eq(employees.status, 'active')));

	// Calling the real (stub) function here — this always throws today.
	computePayrollLine({
		personRef: activeEmployees[0]?.id ?? '',
		costCenter: null,
		daysWorked: 0,
		hoursRegular: 0,
		hoursOt: 0,
		hoursNightDiff: 0,
		baseRateCentavos: 0,
		cashAdvanceDeductionCentavos: 0
	});
	// Unreachable while computePayrollLine is a stub — kept so this function's real
	// implementation (looping computePayrollLine per employee, inserting payrollRunLines
	// rows) has an obvious place to land once the statutory tables exist.
	throw new Error(`unreachable: ${runId}`);
}
