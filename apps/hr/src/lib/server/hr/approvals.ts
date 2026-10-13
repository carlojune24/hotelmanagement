import { asc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import {
	calendarDays,
	employees,
	establishments,
	leaveRequests,
	leaveTypes,
	overtimeRequests,
	schedulePeriods,
	users
} from '$lib/server/db/schema/index';
import { addDays } from '$lib/roster';
import { dtrSubmissions } from '$lib/server/db/schema/index';
import { listSubmittedDtr, type PendingDtr } from './dtr-submissions';

export interface PendingLeave {
	id: string;
	establishmentId: string;
	establishmentName: string;
	person: string;
	typeName: string;
	startDate: string;
	endDate: string;
	days: number;
	halfDay: string | null;
	reason: string | null;
	submittedBy: string | null;
	submittedAt: Date | null;
}

export interface PendingOvertime {
	id: string;
	establishmentId: string;
	establishmentName: string;
	person: string;
	date: string;
	startTime: string;
	endTime: string;
	minutes: number;
	reason: string | null;
	submittedBy: string | null;
	submittedAt: Date | null;
}

export interface PendingMemo {
	id: string;
	establishmentId: string;
	establishmentName: string;
	date: string;
	name: string;
	kind: string;
	creditMinutes: number | null;
	waiveLateness: boolean;
	submittedBy: string | null;
	submittedAt: Date | null;
}

export interface PendingWeek {
	establishmentId: string;
	establishmentName: string;
	establishmentSlug: string;
	weekStart: string;
	weekEnd: string;
	submittedBy: string | null;
	submittedAt: Date | null;
}

export interface PendingApprovals {
	dtr: PendingDtr[];
	weeks: PendingWeek[];
	leave: PendingLeave[];
	overtime: PendingOvertime[];
	memos: PendingMemo[];
}

const submitter = users.name;

/** Everything waiting on Main HR across the company, oldest first. */
export async function listPendingApprovals(): Promise<PendingApprovals> {
	const [dtr, weeks, leave, overtime, memos] = await Promise.all([
		listSubmittedDtr(),
		db
			.select({
				establishmentId: schedulePeriods.establishmentId,
				establishmentName: establishments.name,
				establishmentSlug: establishments.slug,
				weekStart: schedulePeriods.weekStart,
				submittedBy: submitter,
				submittedAt: schedulePeriods.submittedAt
			})
			.from(schedulePeriods)
			.innerJoin(establishments, eq(establishments.id, schedulePeriods.establishmentId))
			.leftJoin(users, eq(users.id, schedulePeriods.submittedByUserId))
			.where(eq(schedulePeriods.status, 'submitted'))
			.orderBy(asc(schedulePeriods.submittedAt)),
		db
			.select({
				id: leaveRequests.id,
				establishmentId: leaveRequests.establishmentId,
				establishmentName: establishments.name,
				person: sql<string>`${employees.lastName} || ', ' || ${employees.firstName}`,
				typeName: leaveTypes.name,
				startDate: leaveRequests.startDate,
				endDate: leaveRequests.endDate,
				days: leaveRequests.days,
				halfDay: leaveRequests.halfDay,
				reason: leaveRequests.reason,
				submittedBy: submitter,
				submittedAt: leaveRequests.submittedAt
			})
			.from(leaveRequests)
			.innerJoin(establishments, eq(establishments.id, leaveRequests.establishmentId))
			.innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
			.innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
			.leftJoin(users, eq(users.id, leaveRequests.submittedByUserId))
			.where(eq(leaveRequests.status, 'submitted'))
			.orderBy(asc(leaveRequests.submittedAt)),
		db
			.select({
				id: overtimeRequests.id,
				establishmentId: overtimeRequests.establishmentId,
				establishmentName: establishments.name,
				person: sql<string>`${employees.lastName} || ', ' || ${employees.firstName}`,
				date: overtimeRequests.date,
				startTime: sql<string>`to_char(${overtimeRequests.startTime}, 'HH24:MI')`,
				endTime: sql<string>`to_char(${overtimeRequests.endTime}, 'HH24:MI')`,
				minutes: overtimeRequests.minutes,
				reason: overtimeRequests.reason,
				submittedBy: submitter,
				submittedAt: overtimeRequests.submittedAt
			})
			.from(overtimeRequests)
			.innerJoin(establishments, eq(establishments.id, overtimeRequests.establishmentId))
			.innerJoin(employees, eq(employees.id, overtimeRequests.employeeId))
			.leftJoin(users, eq(users.id, overtimeRequests.submittedByUserId))
			.where(eq(overtimeRequests.status, 'submitted'))
			.orderBy(asc(overtimeRequests.submittedAt)),
		db
			.select({
				id: calendarDays.id,
				establishmentId: calendarDays.establishmentId,
				establishmentName: establishments.name,
				date: calendarDays.date,
				name: calendarDays.name,
				kind: calendarDays.kind,
				creditMinutes: calendarDays.creditMinutes,
				waiveLateness: calendarDays.waiveLateness,
				submittedBy: submitter,
				submittedAt: calendarDays.submittedAt
			})
			.from(calendarDays)
			.innerJoin(establishments, eq(establishments.id, calendarDays.establishmentId))
			.leftJoin(users, eq(users.id, calendarDays.submittedByUserId))
			.where(eq(calendarDays.status, 'submitted'))
			.orderBy(asc(calendarDays.submittedAt))
	]);
	return {
		dtr,
		weeks: weeks.map((w) => ({ ...w, weekEnd: addDays(w.weekStart, 6) })),
		leave,
		overtime,
		memos
	};
}

/** Cheap total for the sidebar badge. */
export async function pendingApprovalCount(): Promise<number> {
	const count = async (table: typeof leaveRequests | typeof overtimeRequests | typeof calendarDays | typeof schedulePeriods | typeof dtrSubmissions) => {
		const [r] = await db
			.select({ n: sql<number>`count(*)::int` })
			.from(table)
			.where(eq(table.status, 'submitted'));
		return r?.n ?? 0;
	};
	const [a, b, c, d, e] = await Promise.all([
		count(leaveRequests),
		count(overtimeRequests),
		count(calendarDays),
		count(schedulePeriods),
		count(dtrSubmissions)
	]);
	return a + b + c + d + e;
}
