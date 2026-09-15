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
import { employees, memberships, roles } from '$lib/server/db/schema/index';
import { mintRef } from '$lib/server/ids';

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

function toInsertValues(hotelId: string, input: EmployeeFormInput) {
	return {
		hotelId,
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
		// set from Settings → Team's own "Linked employee" picker (see below).
	};
}

/** Every non-archived employee for the hotel, including which Team account (if
    any) it's already linked to — the raw list Settings → Team builds its own
    per-member "Linked employee" picker from (filtering to unlinked-or-mine
    there, since the same list is shared across every member row). */
export async function listEmployeesForLinking(hotelId: string) {
	return db
		.select({
			id: employees.id,
			firstName: employees.firstName,
			lastName: employees.lastName,
			employeeNo: employees.employeeNo,
			userId: employees.userId
		})
		.from(employees)
		.where(and(eq(employees.hotelId, hotelId), isNull(employees.deletedAt)))
		.orderBy(asc(employees.lastName), asc(employees.firstName));
}

/** Links (or, with `employeeId: null`, unlinks) one Team member to one employee
 *  record — the only writer of `employees.user_id` now that the Employees form
 *  itself never touches it. Clears whatever employee `memberUserId` was
 *  previously linked to first, so a member is never linked to two employees at
 *  once (the DB's own unique constraint on `employees.user_id` is the backstop
 *  if this ever raced with another admin). */
export async function linkMemberToEmployee(
	hotelId: string,
	memberUserId: string,
	employeeId: string | null
): Promise<void> {
	await db.transaction(async (tx) => {
		await tx
			.update(employees)
			.set({ userId: null, updatedAt: new Date() })
			.where(and(eq(employees.hotelId, hotelId), eq(employees.userId, memberUserId)));
		if (employeeId) {
			await tx
				.update(employees)
				.set({ userId: memberUserId, updatedAt: new Date() })
				.where(and(eq(employees.hotelId, hotelId), eq(employees.id, employeeId)));
		}
	});
}

export async function listEmployees(hotelId: string) {
	return db
		.select()
		.from(employees)
		.where(and(eq(employees.hotelId, hotelId), isNull(employees.deletedAt)))
		.orderBy(asc(employees.lastName), asc(employees.firstName));
}

/** `listEmployees`, each row also carrying the Team role of whichever member (if
 *  any) it's linked to — view-only in HR; the link itself is only ever made or
 *  changed from Settings → Team's own "Linked employee" picker. */
export async function listEmployeesWithTeamRole(hotelId: string) {
	const [rows, memberRoles] = await Promise.all([
		listEmployees(hotelId),
		db
			.select({ userId: memberships.userId, roleName: roles.name })
			.from(memberships)
			.innerJoin(roles, eq(roles.id, memberships.roleId))
			.where(eq(memberships.hotelId, hotelId))
	]);
	const roleByUserId = new Map(memberRoles.map((r) => [r.userId, r.roleName]));
	return rows.map((e) => ({
		...e,
		teamRoleName: e.userId ? (roleByUserId.get(e.userId) ?? null) : null
	}));
}

export async function getEmployee(hotelId: string, id: string) {
	return db
		.select()
		.from(employees)
		.where(and(eq(employees.hotelId, hotelId), eq(employees.id, id)))
		.then((r) => r.at(0) ?? null);
}

export async function createEmployee(hotelId: string, input: EmployeeFormInput, photoUrl: string | null) {
	const [row] = await db
		.insert(employees)
		.values({ ...toInsertValues(hotelId, input), photoUrl, personRef: mintRef('person') })
		.returning();
	return row!;
}

export async function updateEmployee(
	hotelId: string,
	id: string,
	input: EmployeeFormInput,
	photoUrl: string | null
) {
	const [row] = await db
		.update(employees)
		.set({ ...toInsertValues(hotelId, input), photoUrl, updatedAt: new Date() })
		.where(and(eq(employees.hotelId, hotelId), eq(employees.id, id)))
		.returning();
	return row ?? null;
}

/** Soft-delete — an employee record is kept for payroll/DTR history, never hard-deleted. */
export async function archiveEmployee(hotelId: string, id: string) {
	await db
		.update(employees)
		.set({ deletedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(employees.hotelId, hotelId), eq(employees.id, id)));
}
