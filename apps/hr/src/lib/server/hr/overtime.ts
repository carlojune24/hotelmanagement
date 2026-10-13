import { and, desc, eq, gte, isNull, lte, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { employeeAssignments, employees, overtimeRequests } from '$lib/server/db/schema/index';
import { assignedHere } from './assigned';
import { overtimeMinutes, overtimeRangeError, rangesOverlap } from '$lib/overtime';
import { isDateString, timeToMinutes, toHHMM } from '$lib/roster';

export class OvertimeError extends Error {}

const hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'Enter a time.');

export const overtimeFormSchema = z.object({
	employeeId: z.string().uuid('Pick an employee.'),
	date: z.string().refine(isDateString, 'Pick a date.'),
	startTime: hhmm,
	endTime: hhmm,
	reason: z.string().trim().max(200).default('')
});
export type OvertimeFormInput = z.infer<typeof overtimeFormSchema>;

/** A range as minutes from midnight of its date, running past 1440 when it crosses midnight. */
function span(start: string, end: string): [number, number] {
	const s = timeToMinutes(start)!;
	return [s, s + overtimeMinutes(start, end)];
}

export async function fileOvertime(establishmentId: string, input: OvertimeFormInput, userId: string | null) {
	const why = overtimeRangeError(input.startTime, input.endTime);
	if (why) throw new OvertimeError(why);

	const [emp] = await db
		.select({ id: employees.id, status: employees.status })
		.from(employees)
		.where(and(assignedHere(establishmentId), eq(employees.id, input.employeeId)));
	if (!emp) throw new OvertimeError('That employee no longer exists.');
	if (emp.status === 'separated') throw new OvertimeError('That employee has separated.');

	const same = await db
		.select({ start: overtimeRequests.startTime, end: overtimeRequests.endTime })
		.from(overtimeRequests)
		.where(
			and(
				eq(overtimeRequests.establishmentId, establishmentId),
				eq(overtimeRequests.employeeId, emp.id),
				eq(overtimeRequests.date, input.date),
				eq(overtimeRequests.status, 'approved')
			)
		);
	const mine = span(input.startTime, input.endTime);
	if (same.some((r) => rangesOverlap(mine, span(toHHMM(r.start)!, toHHMM(r.end)!)))) {
		throw new OvertimeError('This person already has overtime filed for part of that time.');
	}

	const [row] = await db
		.insert(overtimeRequests)
		.values({
			establishmentId,
			employeeId: emp.id,
			date: input.date,
			startTime: input.startTime,
			endTime: input.endTime,
			minutes: overtimeMinutes(input.startTime, input.endTime),
			reason: input.reason || null,
			status: 'approved',
			filedByUserId: userId
		})
		.returning();
	return row!;
}

export async function cancelOvertime(establishmentId: string, id: string, note: string, userId: string | null) {
	const [row] = await db
		.update(overtimeRequests)
		.set({
			status: 'cancelled',
			cancelledAt: new Date(),
			cancelledByUserId: userId,
			cancelNote: note || null,
			updatedAt: new Date()
		})
		.where(
			and(
				eq(overtimeRequests.establishmentId, establishmentId),
				eq(overtimeRequests.id, id),
				ne(overtimeRequests.status, 'cancelled')
			)
		)
		.returning();
	if (!row) throw new OvertimeError('That overtime is already cancelled.');
	return row;
}

/** Applications for `[from, to]` (inclusive dates), newest first, with who they're for. */
export async function listOvertime(establishmentId: string, from: string, to: string) {
	const rows = await db
		.select({
			id: overtimeRequests.id,
			employeeId: overtimeRequests.employeeId,
			employeeName: sql<string>`${employees.lastName} || ', ' || ${employees.firstName}`,
			position: sql<string>`coalesce(${employeeAssignments.position}, '')`,
			date: overtimeRequests.date,
			startTime: overtimeRequests.startTime,
			endTime: overtimeRequests.endTime,
			minutes: overtimeRequests.minutes,
			reason: overtimeRequests.reason,
			status: overtimeRequests.status,
			cancelNote: overtimeRequests.cancelNote
		})
		.from(overtimeRequests)
		.innerJoin(employees, eq(employees.id, overtimeRequests.employeeId))
		.leftJoin(
			employeeAssignments,
			and(
				eq(employeeAssignments.employeeId, overtimeRequests.employeeId),
				eq(employeeAssignments.establishmentId, overtimeRequests.establishmentId),
				isNull(employeeAssignments.endDate)
			)
		)
		.where(
			and(
				eq(overtimeRequests.establishmentId, establishmentId),
				gte(overtimeRequests.date, from),
				lte(overtimeRequests.date, to)
			)
		)
		.orderBy(desc(overtimeRequests.date), employees.lastName);
	return rows.map((r) => ({
		...r,
		startTime: toHHMM(r.startTime)!,
		endTime: toHHMM(r.endTime)!
	}));
}

/** Approved ranges keyed `employeeId|date`, for the DTR to credit against punched overtime. */
export async function listApprovedOvertime(establishmentId: string, from: string, to: string) {
	const rows = await db
		.select({
			employeeId: overtimeRequests.employeeId,
			date: overtimeRequests.date,
			startTime: overtimeRequests.startTime,
			endTime: overtimeRequests.endTime
		})
		.from(overtimeRequests)
		.where(
			and(
				eq(overtimeRequests.establishmentId, establishmentId),
				eq(overtimeRequests.status, 'approved'),
				gte(overtimeRequests.date, from),
				lte(overtimeRequests.date, to)
			)
		);
	const out = new Map<string, Array<{ startTime: string; endTime: string }>>();
	for (const r of rows) {
		const key = `${r.employeeId}|${r.date}`;
		out.set(key, [
			...(out.get(key) ?? []),
			{ startTime: toHHMM(r.startTime)!, endTime: toHHMM(r.endTime)! }
		]);
	}
	return out;
}
