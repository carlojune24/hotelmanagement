import { eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import {
	employeeAssignments,
	employees,
	establishments,
	leaveTypes,
	organizations
} from '$lib/server/db/schema/index';
import { mintRef } from '$lib/server/ids';

/** The organization the throwaway test establishments hang off: the existing one, or a
 *  placeholder when the DB has none (a real database always has one from `db:seed`). */
export async function testOrgId(): Promise<string> {
	const existing = await db.select({ id: organizations.id }).from(organizations).limit(1);
	if (existing[0]) return existing[0].id;
	const [org] = await db
		.insert(organizations)
		.values({ orgRef: mintRef('org'), name: 'HR test organization' })
		.returning({ id: organizations.id });
	return org!.id;
}

/** A throwaway company. Leave types are company-wide, so a test that edits them must use its own. */
export async function createTestOrg(): Promise<string> {
	const [org] = await db
		.insert(organizations)
		.values({ orgRef: mintRef('org'), name: `HR test company ${Math.random().toString(36).slice(2, 8)}` })
		.returning({ id: organizations.id });
	return org!.id;
}

/** Remove a throwaway company after its establishments are gone (leave types first: they restrict it). */
export async function cleanupTestOrg(orgId: string) {
	await db.delete(leaveTypes).where(eq(leaveTypes.organizationId, orgId));
	await db.delete(organizations).where(eq(organizations.id, orgId));
}

/** A person plus an open primary assignment at `establishmentId`. Employee numbers are unique
 *  company-wide, so a random suffix keeps a test from ever colliding with real or parallel data. */
export async function createTestStaff(
	establishmentId: string,
	o: { employeeNo: string; firstName: string; hiredOn?: string; enrollId?: string | null; position?: string }
): Promise<string> {
	const [est] = await db
		.select({ organizationId: establishments.organizationId })
		.from(establishments)
		.where(eq(establishments.id, establishmentId));
	const hiredOn = o.hiredOn ?? '2024-01-01';
	const [e] = await db
		.insert(employees)
		.values({
			organizationId: est!.organizationId,
			personRef: mintRef('person'),
			employeeNo: `${o.employeeNo}-${Math.random().toString(36).slice(2, 8)}`,
			firstName: o.firstName,
			lastName: 'Test',
			birthdate: '1990-01-01',
			sex: 'female',
			hiredOn,
			employmentType: 'regular',
			payBasis: 'monthly',
			baseRateCentavos: 1_000_000
		})
		.returning({ id: employees.id });
	await db.insert(employeeAssignments).values({
		employeeId: e!.id,
		establishmentId,
		startDate: hiredOn,
		isPrimary: true,
		position: o.position ?? 'Tester',
		biometricEnrollId: o.enrollId ?? null
	});
	return e!.id;
}

/** Removes throwaway establishments *and* the people assigned only to them (employees are
 *  company-wide now, so they no longer cascade from an establishment). */
export async function cleanupTestEstablishments(ids: string[]) {
	const live = ids.filter(Boolean);
	if (live.length === 0) return;
	const people = await db
		.select({ id: employeeAssignments.employeeId })
		.from(employeeAssignments)
		.where(inArray(employeeAssignments.establishmentId, live));
	if (people.length) {
		await db.delete(employees).where(inArray(employees.id, people.map((p) => p.id)));
	}
	await db.delete(establishments).where(inArray(establishments.id, live));
}
