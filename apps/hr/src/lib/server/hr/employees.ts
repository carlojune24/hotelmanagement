import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import {
	disbursementMethod,
	employeeStatus,
	employmentType,
	payBasis,
	sex
} from '@mm/hr-core';
import { db } from '$lib/server/db/index';
import { employees } from '$lib/server/db/schema/index';
import { mintRef } from '$lib/server/ids';
import { normalizeEnrollId } from '$lib/hr-import';

export class EmployeeError extends Error {}

export const employeeFormSchema = z.object({
	employeeNo: z.string().trim().min(1).max(40),
	firstName: z.string().trim().min(1).max(120),
	lastName: z.string().trim().min(1).max(120),
	middleName: z.string().trim().max(120).optional(),
	suffix: z.string().trim().max(20).optional(),
	birthdate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	sex,
	hiredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	employmentType,
	status: employeeStatus.default('active'),
	position: z.string().trim().min(1).max(120),
	email: z.string().trim().email('Not a valid email address').max(200).optional().or(z.literal('')),
	biometricEnrollId: z.string().trim().max(40).optional(),
	department: z.string().trim().max(120).optional(),
	costCenter: z.string().trim().max(80).optional(),
	payBasis,
	baseRatePesos: z.coerce.number().min(0),
	sss: z.string().trim().max(40).optional(),
	philhealth: z.string().trim().max(40).optional(),
	pagibig: z.string().trim().max(40).optional(),
	tin: z.string().trim().max(40).optional(),
	disbursementMethod,
	bankCode: z.string().trim().max(40).optional(),
	accountName: z.string().trim().max(160).optional(),
	accountNo: z.string().trim().max(60).optional()
});
export type EmployeeFormInput = z.infer<typeof employeeFormSchema>;

function toInsertValues(establishmentId: string, input: EmployeeFormInput) {
	return {
		establishmentId,
		employeeNo: input.employeeNo,
		firstName: input.firstName,
		lastName: input.lastName,
		middleName: input.middleName || null,
		suffix: input.suffix || null,
		birthdate: input.birthdate,
		sex: input.sex,
		hiredOn: input.hiredOn,
		employmentType: input.employmentType,
		status: input.status,
		position: input.position,
		email: input.email || null,
		biometricEnrollId: input.biometricEnrollId || null,
		department: input.department || null,
		costCenter: input.costCenter || null,
		payBasis: input.payBasis,
		baseRateCentavos: Math.round(input.baseRatePesos * 100),
		govIds: {
			sss: input.sss || undefined,
			philhealth: input.philhealth || undefined,
			pagibig: input.pagibig || undefined,
			tin: input.tin || undefined
		},
		disbursement: {
			method: input.disbursementMethod,
			bank_code: input.bankCode || undefined,
			account_name: input.accountName || undefined,
			account_no: input.accountNo || undefined
		}
		// `userId` is deliberately not set here — the Employee create/update form never
		// touches it, so a routine edit (pay rate, position, etc.) can't clobber a link
	};
}

export async function listEmployees(establishmentId: string) {
	return db
		.select()
		.from(employees)
		.where(and(eq(employees.establishmentId, establishmentId), isNull(employees.deletedAt)))
		.orderBy(asc(employees.lastName), asc(employees.firstName));
}

export async function getEmployee(establishmentId: string, id: string) {
	return db
		.select()
		.from(employees)
		.where(and(eq(employees.establishmentId, establishmentId), eq(employees.id, id)))
		.then((r) => r.at(0) ?? null);
}

/** Biometric import matches punches by this id, so two employees must never share one
 *  (compared the way the import does: `0042`, `42` and `42.0` are the same id). */
async function assertEnrollIdFree(establishmentId: string, enrollId: string | undefined, exceptId?: string) {
	if (!enrollId) return;
	const wanted = normalizeEnrollId(enrollId);
	const rows = await db
		.select({
			id: employees.id,
			firstName: employees.firstName,
			lastName: employees.lastName,
			enroll: employees.biometricEnrollId
		})
		.from(employees)
		.where(and(eq(employees.establishmentId, establishmentId), isNull(employees.deletedAt)));
	const clash = rows.find((r) => r.id !== exceptId && r.enroll && normalizeEnrollId(r.enroll) === wanted);
	if (clash) {
		throw new EmployeeError(`Biometric ID ${enrollId} is already used by ${clash.firstName} ${clash.lastName}.`);
	}
}

export async function createEmployee(establishmentId: string, input: EmployeeFormInput, photoUrl: string | null) {
	await assertEnrollIdFree(establishmentId, input.biometricEnrollId);
	const [row] = await db
		.insert(employees)
		.values({ ...toInsertValues(establishmentId, input), photoUrl, personRef: mintRef('person') })
		.returning();
	return row!;
}

export async function updateEmployee(
	establishmentId: string,
	id: string,
	input: EmployeeFormInput,
	photoUrl: string | null
) {
	await assertEnrollIdFree(establishmentId, input.biometricEnrollId, id);
	const [row] = await db
		.update(employees)
		.set({ ...toInsertValues(establishmentId, input), photoUrl, updatedAt: new Date() })
		.where(and(eq(employees.establishmentId, establishmentId), eq(employees.id, id)))
		.returning();
	return row ?? null;
}

/** Soft-delete — an employee record is kept for payroll/DTR history, never hard-deleted. */
export async function archiveEmployee(establishmentId: string, id: string) {
	await db
		.update(employees)
		.set({ deletedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(employees.establishmentId, establishmentId), eq(employees.id, id)));
}
