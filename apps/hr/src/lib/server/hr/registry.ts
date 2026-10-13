import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { employeeAssignments, employees, establishments } from '$lib/server/db/schema/index';
import { assertEnrollIdFree } from './employees';

export class RegistryError extends Error {}

export interface PersonRow {
	id: string;
	employeeNo: string;
	name: string;
	status: string;
	photoUrl: string | null;
	assignments: Array<{
		id: string;
		establishmentId: string;
		establishmentName: string;
		establishmentSlug: string;
		position: string;
		department: string | null;
		biometricEnrollId: string | null;
		isPrimary: boolean;
		startDate: string;
		endDate: string | null;
	}>;
}

/** Everyone in the company with where they work now (open assignments only). */
export async function listPeople(): Promise<PersonRow[]> {
	const [people, rows] = await Promise.all([
		db
			.select()
			.from(employees)
			.where(isNull(employees.deletedAt))
			.orderBy(asc(employees.lastName), asc(employees.firstName)),
		db
			.select({
				a: employeeAssignments,
				estName: establishments.name,
				estSlug: establishments.slug
			})
			.from(employeeAssignments)
			.innerJoin(establishments, eq(establishments.id, employeeAssignments.establishmentId))
			.where(isNull(employeeAssignments.endDate))
	]);
	return people.map((p) => ({
		id: p.id,
		employeeNo: p.employeeNo,
		name: `${p.lastName}, ${p.firstName}`,
		status: p.status,
		photoUrl: p.photoUrl,
		assignments: rows
			.filter((r) => r.a.employeeId === p.id)
			.sort((x, y) => Number(y.a.isPrimary) - Number(x.a.isPrimary) || x.estName.localeCompare(y.estName))
			.map((r) => ({
				id: r.a.id,
				establishmentId: r.a.establishmentId,
				establishmentName: r.estName,
				establishmentSlug: r.estSlug,
				position: r.a.position,
				department: r.a.department,
				biometricEnrollId: r.a.biometricEnrollId,
				isPrimary: r.a.isPrimary,
				startDate: r.a.startDate,
				endDate: r.a.endDate
			}))
	}));
}

export async function assignEmployee(input: {
	employeeId: string;
	establishmentId: string;
	startDate: string;
	position: string;
	department?: string;
	biometricEnrollId?: string;
	makePrimary: boolean;
}) {
	const [emp, est] = await Promise.all([
		db.select().from(employees).where(eq(employees.id, input.employeeId)).then((r) => r.at(0)),
		db.select().from(establishments).where(eq(establishments.id, input.establishmentId)).then((r) => r.at(0))
	]);
	if (!emp || emp.deletedAt) throw new RegistryError('That person no longer exists.');
	if (emp.status === 'separated') throw new RegistryError('That person has separated.');
	if (!est || est.deletedAt) throw new RegistryError('That establishment no longer exists.');
	if (est.status !== 'active') throw new RegistryError('That establishment is archived.');
	if (est.organizationId !== emp.organizationId) throw new RegistryError('Different organization.');

	const open = await db
		.select({ id: employeeAssignments.id })
		.from(employeeAssignments)
		.where(
			and(
				eq(employeeAssignments.employeeId, input.employeeId),
				eq(employeeAssignments.establishmentId, input.establishmentId),
				isNull(employeeAssignments.endDate)
			)
		)
		.then((r) => r.at(0));
	if (open) throw new RegistryError(`Already assigned to ${est.name}.`);

	try {
		await assertEnrollIdFree(input.establishmentId, input.biometricEnrollId, input.employeeId);
	} catch (e) {
		throw new RegistryError((e as Error).message);
	}

	return db.transaction(async (tx) => {
		const hasPrimary = await tx
			.select({ id: employeeAssignments.id })
			.from(employeeAssignments)
			.where(
				and(
					eq(employeeAssignments.employeeId, input.employeeId),
					eq(employeeAssignments.isPrimary, true),
					isNull(employeeAssignments.endDate)
				)
			)
			.then((r) => r.length > 0);
		const primary = input.makePrimary || !hasPrimary;
		if (primary && hasPrimary) {
			await tx
				.update(employeeAssignments)
				.set({ isPrimary: false, updatedAt: new Date() })
				.where(
					and(eq(employeeAssignments.employeeId, input.employeeId), isNull(employeeAssignments.endDate))
				);
		}
		const [row] = await tx
			.insert(employeeAssignments)
			.values({
				employeeId: input.employeeId,
				establishmentId: input.establishmentId,
				startDate: input.startDate,
				isPrimary: primary,
				position: input.position,
				department: input.department || null,
				biometricEnrollId: input.biometricEnrollId || null
			})
			.returning();
		return row!;
	});
}

/** Ends an assignment on `endDate` (the last day worked there). If it was the person's home and
 *  they have another open assignment, the oldest becomes home. Schedules and DTR already written
 *  are left alone — history is never rewritten. */
export async function endAssignment(assignmentId: string, endDate: string) {
	const a = await db
		.select()
		.from(employeeAssignments)
		.where(eq(employeeAssignments.id, assignmentId))
		.then((r) => r.at(0));
	if (!a || a.endDate) throw new RegistryError('That assignment is not open.');
	if (endDate < a.startDate) throw new RegistryError('The end date is before the assignment started.');

	await db.transaction(async (tx) => {
		await tx
			.update(employeeAssignments)
			.set({ endDate, isPrimary: false, updatedAt: new Date() })
			.where(eq(employeeAssignments.id, assignmentId));
		if (a.isPrimary) {
			const next = await tx
				.select({ id: employeeAssignments.id })
				.from(employeeAssignments)
				.where(
					and(
						eq(employeeAssignments.employeeId, a.employeeId),
						isNull(employeeAssignments.endDate),
						ne(employeeAssignments.id, assignmentId)
					)
				)
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
	return a;
}

export async function setPrimary(assignmentId: string) {
	const a = await db
		.select()
		.from(employeeAssignments)
		.where(eq(employeeAssignments.id, assignmentId))
		.then((r) => r.at(0));
	if (!a || a.endDate) throw new RegistryError('That assignment is not open.');
	await db.transaction(async (tx) => {
		await tx
			.update(employeeAssignments)
			.set({ isPrimary: false, updatedAt: new Date() })
			.where(and(eq(employeeAssignments.employeeId, a.employeeId), isNull(employeeAssignments.endDate)));
		await tx
			.update(employeeAssignments)
			.set({ isPrimary: true, updatedAt: new Date() })
			.where(eq(employeeAssignments.id, assignmentId));
	});
	return a;
}

/** Establishments a person could still be assigned to (active, and not already open there). */
export async function assignableEstablishments(employeeId: string) {
	const [all, open] = await Promise.all([
		db
			.select({ id: establishments.id, name: establishments.name })
			.from(establishments)
			.where(and(isNull(establishments.deletedAt), eq(establishments.status, 'active')))
			.orderBy(asc(establishments.name)),
		db
			.select({ id: employeeAssignments.establishmentId })
			.from(employeeAssignments)
			.where(and(eq(employeeAssignments.employeeId, employeeId), isNull(employeeAssignments.endDate)))
	]);
	const taken = new Set(open.map((o) => o.id));
	return all.filter((e) => !taken.has(e.id));
}
