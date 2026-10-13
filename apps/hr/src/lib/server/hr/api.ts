import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { employeeAssignments, employees, establishments } from '$lib/server/db/schema/index';
import { openAssignmentAt } from './assigned';

/** What a hotel needs to know about a person — never pay, government IDs or birthdate. */
export interface ApiEmployee {
	person_ref: string;
	employee_no: string;
	first_name: string;
	last_name: string;
	email: string | null;
	status: string;
	/** Post at the establishment the key belongs to; null when they are not assigned there. */
	position: string | null;
	department: string | null;
	/** True when the person has an open assignment at this establishment right now. */
	assigned: boolean;
}

export const MAX_REFS = 200;

type Row = {
	e: typeof employees.$inferSelect;
	a: typeof employeeAssignments.$inferSelect | null;
};

function shape(r: Row): ApiEmployee {
	return {
		person_ref: r.e.personRef,
		employee_no: r.e.employeeNo,
		first_name: r.e.firstName,
		last_name: r.e.lastName,
		email: r.e.email,
		status: r.e.status,
		position: r.a?.position ?? null,
		department: r.a?.department ?? null,
		assigned: r.a !== null
	};
}

/** Everyone with an open assignment at this establishment — the Team picker's list. */
export async function assignedToEstablishment(establishmentId: string): Promise<ApiEmployee[]> {
	const rows = await db
		.select({ e: employees, a: employeeAssignments })
		.from(employeeAssignments)
		.innerJoin(employees, eq(employees.id, employeeAssignments.employeeId))
		.where(and(openAssignmentAt(establishmentId), isNull(employees.deletedAt)))
		.orderBy(asc(employees.lastName), asc(employees.firstName));
	return rows.map(shape);
}

/**
 * The state of specific people, whether or not they are still assigned here — how a hotel notices
 * that someone it linked has since left. Refs outside this key's own organization are ignored, so
 * a key can never be used to probe the rest of the registry.
 */
export async function peopleByRef(establishmentId: string, refs: string[]): Promise<ApiEmployee[]> {
	const wanted = [...new Set(refs.map((r) => r.trim()).filter(Boolean))].slice(0, MAX_REFS);
	if (wanted.length === 0) return [];
	const est = await db
		.select({ organizationId: establishments.organizationId })
		.from(establishments)
		.where(eq(establishments.id, establishmentId))
		.then((r) => r.at(0));
	if (!est) return [];

	const people = await db
		.select()
		.from(employees)
		.where(and(eq(employees.organizationId, est.organizationId), inArray(employees.personRef, wanted)));
	if (people.length === 0) return [];
	const here = await db
		.select()
		.from(employeeAssignments)
		.where(
			and(
				openAssignmentAt(establishmentId),
				inArray(
					employeeAssignments.employeeId,
					people.map((p) => p.id)
				)
			)
		);
	const byEmployee = new Map(here.map((a) => [a.employeeId, a]));
	return people.map((e) =>
		shape({
			// A soft-deleted person is reported as separated so the hotel treats them as gone.
			e: e.deletedAt ? { ...e, status: 'separated' } : e,
			a: byEmployee.get(e.id) ?? null
		})
	);
}
