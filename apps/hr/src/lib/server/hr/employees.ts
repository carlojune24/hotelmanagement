import { and, asc, eq, gte, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { assertCostCenter } from './cost-centers';
import {
	disbursementMethod,
	employeeStatus,
	employmentType,
	payBasis,
	sex
} from '@mm/hr-core';
import { db } from '$lib/server/db/index';
import { employeeAssignments, employees, establishments, salaryHistory } from '$lib/server/db/schema/index';
import { openAssignmentAt, toStaff, type StaffMember } from './assigned';
import { mintRef } from '$lib/server/ids';
import { normalizeEnrollId } from '$lib/hr-import';

export class EmployeeError extends Error {}

/** An empty form field arrives as ''; treat it as "not given". */
const blankToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
	z.preprocess((v) => (v === '' || v === null ? undefined : v), schema);

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
	/** Present when the coverage section was on the submitted form (an unticked box isn't posted). */
	coverageSubmitted: z.string().optional(),
	sssCovered: z.string().optional(),
	philhealthCovered: z.string().optional(),
	pagibigCovered: z.string().optional(),
	withholdingExempt: z.string().optional(),
	coverageNote: z.string().trim().max(300).optional(),
	sssBasePesos: blankToUndefined(z.coerce.number().positive().max(10_000_000).optional()),
	philhealthBasePesos: blankToUndefined(z.coerce.number().positive().max(10_000_000).optional()),
	pagibigBasePesos: blankToUndefined(z.coerce.number().positive().max(10_000_000).optional()),
	disbursementMethod,
	bankCode: z.string().trim().max(40).optional(),
	accountName: z.string().trim().max(160).optional(),
	accountNo: z.string().trim().max(60).optional()
});
export type EmployeeFormInput = z.infer<typeof employeeFormSchema>;

/** Government coverage columns from the form; empty when the section wasn't submitted (keeps what's stored). */
function toCoverageValues(input: EmployeeFormInput) {
	if (!input.coverageSubmitted) return {};
	const statutoryOverrides = {
		...(input.sssBasePesos ? { sss_msc: Math.round(input.sssBasePesos * 100) } : {}),
		...(input.philhealthBasePesos ? { philhealth_base: Math.round(input.philhealthBasePesos * 100) } : {}),
		...(input.pagibigBasePesos ? { pagibig_base: Math.round(input.pagibigBasePesos * 100) } : {})
	};
	const values = {
		sssCovered: input.sssCovered === 'on',
		philhealthCovered: input.philhealthCovered === 'on',
		pagibigCovered: input.pagibigCovered === 'on',
		withholdingExempt: input.withholdingExempt === 'on',
		coverageNote: input.coverageNote || null,
		statutoryOverrides
	};
	const departs =
		!values.sssCovered ||
		!values.philhealthCovered ||
		!values.pagibigCovered ||
		values.withholdingExempt ||
		Object.keys(statutoryOverrides).length > 0;
	if (departs && !values.coverageNote) {
		throw new EmployeeError('Say why this person is not covered or has a different salary base.');
	}
	return values;
}

/** The person-level fields. Where they work (post, department, device ID) is the assignment. */
function toEmployeeValues(input: EmployeeFormInput) {
	return {
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
		email: input.email || null,
		costCenter: input.costCenter || null,
		payBasis: input.payBasis,
		baseRateCentavos: Math.round(input.baseRatePesos * 100),
		govIds: {
			sss: input.sss || undefined,
			philhealth: input.philhealth || undefined,
			pagibig: input.pagibig || undefined,
			tin: input.tin || undefined
		},
		...toCoverageValues(input),
		disbursement: {
			method: input.disbursementMethod,
			bank_code: input.bankCode || undefined,
			account_name: input.accountName || undefined,
			account_no: input.accountNo || undefined
		}
	};
}

/** The assignment-level fields of the form. */
function toAssignmentValues(input: EmployeeFormInput) {
	return {
		position: input.position,
		department: input.department || null,
		biometricEnrollId: input.biometricEnrollId || null
	};
}

/** The establishment's current staff, each carrying *this* establishment's assignment. */
export async function listEmployees(establishmentId: string): Promise<StaffMember[]> {
	const rows = await db
		.select({ e: employees, a: employeeAssignments })
		.from(employeeAssignments)
		.innerJoin(employees, eq(employees.id, employeeAssignments.employeeId))
		.where(and(openAssignmentAt(establishmentId), isNull(employees.deletedAt)))
		.orderBy(asc(employees.lastName), asc(employees.firstName));
	return rows.map((r) => toStaff(r.e, r.a));
}

export async function getEmployee(establishmentId: string, id: string): Promise<StaffMember | null> {
	const row = await db
		.select({ e: employees, a: employeeAssignments })
		.from(employeeAssignments)
		.innerJoin(employees, eq(employees.id, employeeAssignments.employeeId))
		.where(and(openAssignmentAt(establishmentId), eq(employees.id, id), isNull(employees.deletedAt)))
		.then((r) => r.at(0));
	return row ? toStaff(row.e, row.a) : null;
}

/** Biometric import matches punches by this id, so two people at one establishment must never
 *  share one (compared the way the import does: `0042`, `42` and `42.0` are the same id). */
export async function assertEnrollIdFree(
	establishmentId: string,
	enrollId: string | null | undefined,
	exceptEmployeeId?: string
) {
	if (!enrollId) return;
	const wanted = normalizeEnrollId(enrollId);
	const rows = await db
		.select({
			employeeId: employeeAssignments.employeeId,
			firstName: employees.firstName,
			lastName: employees.lastName,
			enroll: employeeAssignments.biometricEnrollId
		})
		.from(employeeAssignments)
		.innerJoin(employees, eq(employees.id, employeeAssignments.employeeId))
		.where(and(openAssignmentAt(establishmentId), isNull(employees.deletedAt)));
	const clash = rows.find(
		(r) => r.employeeId !== exceptEmployeeId && r.enroll && normalizeEnrollId(r.enroll) === wanted
	);
	if (clash) {
		throw new EmployeeError(`Biometric ID ${enrollId} is already used by ${clash.firstName} ${clash.lastName}.`);
	}
}

async function assertEmployeeNoFree(organizationId: string, employeeNo: string, exceptId?: string) {
	const clash = await db
		.select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName })
		.from(employees)
		.where(
			and(
				eq(employees.organizationId, organizationId),
				eq(employees.employeeNo, employeeNo),
				exceptId ? ne(employees.id, exceptId) : undefined
			)
		)
		.then((r) => r.at(0));
	if (clash) {
		throw new EmployeeError(
			`Employee # ${employeeNo} is already used by ${clash.firstName} ${clash.lastName}. Numbers are unique across the whole company.`
		);
	}
}

/** Registers a person company-wide and assigns them here as their home establishment. */
export async function createEmployee(establishmentId: string, input: EmployeeFormInput, photoUrl: string | null) {
	const est = await db
		.select({ organizationId: establishments.organizationId })
		.from(establishments)
		.where(eq(establishments.id, establishmentId))
		.then((r) => r.at(0));
	if (!est) throw new EmployeeError('Establishment not found.');
	await assertEmployeeNoFree(est.organizationId, input.employeeNo);
	await assertCostCenter(est.organizationId, input.costCenter);
	await assertEnrollIdFree(establishmentId, input.biometricEnrollId);

	return db.transaction(async (tx) => {
		const [row] = await tx
			.insert(employees)
			.values({
				...toEmployeeValues(input),
				organizationId: est.organizationId,
				photoUrl,
				personRef: mintRef('person')
			})
			.returning();
		await tx.insert(employeeAssignments).values({
			employeeId: row!.id,
			establishmentId,
			startDate: input.hiredOn,
			isPrimary: true,
			...toAssignmentValues(input)
		});
		await tx.insert(salaryHistory).values({
			employeeId: row!.id,
			effectiveFrom: input.hiredOn,
			payBasis: input.payBasis,
			baseRateCentavos: Math.round(input.baseRatePesos * 100),
			remarks: 'Starting salary'
		});
		return row!;
	});
}

/** Edits the person and, for the open assignment *here*, their post/department/device ID. */
export async function updateEmployee(
	establishmentId: string,
	id: string,
	input: EmployeeFormInput,
	photoUrl: string | null
) {
	const current = await getEmployee(establishmentId, id);
	if (!current) return null;
	await assertEmployeeNoFree(current.organizationId, input.employeeNo, id);
	await assertCostCenter(current.organizationId, input.costCenter, current.costCenter);
	await assertEnrollIdFree(establishmentId, input.biometricEnrollId, id);

	return db.transaction(async (tx) => {
		// The rate is not part of this form: it changes only through Adjust salary, so it is always recorded.
		const { payBasis: _basis, baseRateCentavos: _rate, ...person } = toEmployeeValues(input);
		const [row] = await tx
			.update(employees)
			.set({ ...person, photoUrl, updatedAt: new Date() })
			.where(eq(employees.id, id))
			.returning();
		await tx
			.update(employeeAssignments)
			.set({ ...toAssignmentValues(input), updatedAt: new Date() })
			.where(eq(employeeAssignments.id, current.assignmentId));
		return row ?? null;
	});
}

/** Removes this person from this establishment's staff *now*. The person, their history and any
 *  other assignment are kept; if this was their home, the oldest remaining one becomes home.
 *  An assignment that only started today never took effect, so it is deleted outright rather than
 *  ended "yesterday" (before it began). */
export async function archiveEmployee(establishmentId: string, id: string) {
	const current = await getEmployee(establishmentId, id);
	if (!current) return;
	await db.transaction(async (tx) => {
		const startsToday = await tx
			.select({ id: employeeAssignments.id })
			.from(employeeAssignments)
			.where(and(eq(employeeAssignments.id, current.assignmentId), gte(employeeAssignments.startDate, sql`current_date`)))
			.then((r) => r.length > 0);
		if (startsToday) {
			await tx.delete(employeeAssignments).where(eq(employeeAssignments.id, current.assignmentId));
		} else {
			// Inclusive end date: yesterday means "no longer here today".
			await tx
				.update(employeeAssignments)
				.set({ endDate: sql`(current_date - 1)`, isPrimary: false, updatedAt: new Date() })
				.where(eq(employeeAssignments.id, current.assignmentId));
		}
		if (current.isPrimary) {
			const next = await tx
				.select({ id: employeeAssignments.id })
				.from(employeeAssignments)
				.where(and(eq(employeeAssignments.employeeId, id), isNull(employeeAssignments.endDate)))
				.orderBy(asc(employeeAssignments.startDate))
				.limit(1)
				.then((r) => r.at(0));
			if (next) {
				await tx
					.update(employeeAssignments)
					.set({ isPrimary: true, updatedAt: new Date() })
					.where(eq(employeeAssignments.id, next.id));
			}
		}
	});
}
