import { and, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { employeeAssignments, employees, type Employee } from '$lib/server/db/schema/index';

/**
 * An employee as one establishment sees them: the company-wide person plus *that establishment's*
 * assignment (post, department, biometric device ID). Everything built for "an establishment's
 * staff" — roster, DTR, leave — works with this shape.
 */
export type StaffMember = Employee & {
	assignmentId: string;
	position: string;
	department: string | null;
	biometricEnrollId: string | null;
	isPrimary: boolean;
	assignedFrom: string;
	assignedUntil: string | null;
};

// shortcut: "open" is judged against the database's current_date, not the establishment's own
// timezone — off by at most a few hours around midnight. Upgrade when assignments need exact cutoffs.
const stillOpen = () =>
	or(isNull(employeeAssignments.endDate), gte(employeeAssignments.endDate, sql`current_date`));

/** True for employees with an open assignment at `establishmentId` — the single definition of
 *  "this establishment's staff" used by every roster, DTR and leave query. */
export function assignedHere(establishmentId: string) {
	return inArray(
		employees.id,
		db
			.select({ id: employeeAssignments.employeeId })
			.from(employeeAssignments)
			.where(and(eq(employeeAssignments.establishmentId, establishmentId), stillOpen()))
	);
}

export const openAssignmentAt = (establishmentId: string) =>
	and(eq(employeeAssignments.establishmentId, establishmentId), stillOpen());

export function toStaff(
	e: Employee,
	a: typeof employeeAssignments.$inferSelect
): StaffMember {
	return {
		...e,
		assignmentId: a.id,
		position: a.position,
		department: a.department,
		biometricEnrollId: a.biometricEnrollId,
		isPrimary: a.isPrimary,
		assignedFrom: a.startDate,
		assignedUntil: a.endDate
	};
}
