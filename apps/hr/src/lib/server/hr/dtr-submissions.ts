import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import {
	dtrEntries,
	employees,
	establishments,
	schedules,
	users,
	dtrSubmissions
} from '$lib/server/db/schema/index';
import { monthBounds, mondayOf } from '$lib/roster';
import { assignedHere } from './assigned';
import { weekStatuses } from './schedule-periods';

export class DtrSubmissionError extends Error {}

export type DtrStatus = 'draft' | 'submitted' | 'received' | 'returned';

export interface DtrHandoff {
	month: string;
	start: string;
	end: string;
	status: DtrStatus;
	note: string | null;
	submittedAt: Date | null;
	decidedAt: Date | null;
}

const monthRe = /^\d{4}-\d{2}$/;

function cutoff(month: string) {
	if (!monthRe.test(month)) throw new DtrSubmissionError('Pick a month.');
	return monthBounds(`${month}-01`);
}

export async function getHandoff(establishmentId: string, month: string): Promise<DtrHandoff> {
	const { start, end } = cutoff(month);
	const row = await db
		.select()
		.from(dtrSubmissions)
		.where(
			and(
				eq(dtrSubmissions.establishmentId, establishmentId),
				eq(dtrSubmissions.cutoffStart, start),
				eq(dtrSubmissions.cutoffEnd, end)
			)
		)
		.then((r) => r.at(0));
	return {
		month,
		start,
		end,
		status: (row?.status as DtrStatus | undefined) ?? 'draft',
		note: row?.decisionNote ?? null,
		submittedAt: row?.submittedAt ?? null,
		decidedAt: row?.decidedAt ?? null
	};
}

/**
 * The single guard every DTR write goes through. A cutoff Main HR holds (submitted or received)
 * is read-only for managers; Main HR itself may still correct it (and is audit-logged by callers).
 * Returns a message to show, or null when the write may proceed.
 */
export async function dtrLockMessage(
	establishmentId: string,
	month: string,
	byApprover: boolean
): Promise<string | null> {
	if (byApprover || !monthRe.test(month)) return null;
	const h = await getHandoff(establishmentId, month);
	if (h.status === 'submitted') {
		return 'This month’s DTR is with Main HR. Ask them to return it if something needs correcting.';
	}
	if (h.status === 'received') {
		return 'Main HR has received this month’s DTR, so it is locked. Ask them to return it to correct it.';
	}
	return null;
}

export interface HandoffWarnings {
	/** Staff with no saved DTR rows for the month. */
	missingEmployees: string[];
	/** Roster weeks in the month that have shifts but are not approved. */
	unapprovedWeeks: string[];
}

export async function handoffWarnings(establishmentId: string, month: string): Promise<HandoffWarnings> {
	const { start, end } = cutoff(month);
	const [staff, saved, rostered] = await Promise.all([
		db
			.select({ id: employees.id, name: sql<string>`${employees.lastName} || ', ' || ${employees.firstName}` })
			.from(employees)
			.where(and(assignedHere(establishmentId), isNull(employees.deletedAt)))
			.orderBy(asc(employees.lastName)),
		db
			.selectDistinct({ id: dtrEntries.employeeId })
			.from(dtrEntries)
			.where(
				and(
					eq(dtrEntries.establishmentId, establishmentId),
					gte(dtrEntries.date, start),
					lte(dtrEntries.date, end),
					isNull(dtrEntries.deletedAt)
				)
			),
		db
			.selectDistinct({ date: schedules.date })
			.from(schedules)
			.where(
				and(
					eq(schedules.establishmentId, establishmentId),
					isNull(schedules.deletedAt),
					gte(schedules.date, start),
					lte(schedules.date, end)
				)
			)
	]);
	const savedIds = new Set(saved.map((s) => s.id));
	const weeks = [...new Set(rostered.map((r) => mondayOf(r.date)))].sort();
	const statuses = await weekStatuses(establishmentId, weeks);
	return {
		missingEmployees: staff.filter((s) => !savedIds.has(s.id)).map((s) => s.name),
		unapprovedWeeks: weeks.filter((w) => statuses[w]?.status !== 'approved')
	};
}

/** Manager → Main HR. Needs something saved, and is only for a draft or returned cutoff. */
export async function submitDtr(establishmentId: string, month: string, userId: string | null) {
	const { start, end } = cutoff(month);
	const current = await getHandoff(establishmentId, month);
	if (current.status === 'submitted') throw new DtrSubmissionError('This month is already with Main HR.');
	if (current.status === 'received') throw new DtrSubmissionError('Main HR has already received this month.');

	const [{ n } = { n: 0 }] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(dtrEntries)
		.where(
			and(
				eq(dtrEntries.establishmentId, establishmentId),
				gte(dtrEntries.date, start),
				lte(dtrEntries.date, end),
				isNull(dtrEntries.deletedAt)
			)
		);
	if (n === 0) throw new DtrSubmissionError('Save the month’s DTR first — nothing is saved to send yet.');

	const now = new Date();
	await db
		.insert(dtrSubmissions)
		.values({
			establishmentId,
			cutoffStart: start,
			cutoffEnd: end,
			status: 'submitted',
			submittedByUserId: userId,
			submittedAt: now
		})
		.onConflictDoUpdate({
			target: [dtrSubmissions.establishmentId, dtrSubmissions.cutoffStart, dtrSubmissions.cutoffEnd],
			set: {
				status: 'submitted',
				submittedByUserId: userId,
				submittedAt: now,
				decidedByUserId: null,
				decidedAt: null,
				decisionNote: null,
				updatedAt: now
			}
		});
}

/** Main HR accepts a submitted DTR; it stays locked for managers. */
export async function receiveDtr(id: string, userId: string | null) {
	const [row] = await db
		.update(dtrSubmissions)
		.set({ status: 'received', decidedByUserId: userId, decidedAt: new Date(), decisionNote: null, updatedAt: new Date() })
		.where(and(eq(dtrSubmissions.id, id), eq(dtrSubmissions.status, 'submitted')))
		.returning();
	if (!row) throw new DtrSubmissionError('That DTR is no longer waiting to be received.');
	return row;
}

/** Main HR sends a submitted or received DTR back with a note; the manager can correct and resend. */
export async function returnDtr(id: string, note: string, userId: string | null) {
	if (!note.trim()) throw new DtrSubmissionError('Say what needs correcting so the manager knows what to fix.');
	const [row] = await db
		.update(dtrSubmissions)
		.set({
			status: 'returned',
			decidedByUserId: userId,
			decidedAt: new Date(),
			decisionNote: note.trim(),
			updatedAt: new Date()
		})
		.where(and(eq(dtrSubmissions.id, id), inArray(dtrSubmissions.status, ['submitted', 'received'])))
		.returning();
	if (!row) throw new DtrSubmissionError('That DTR is not with Main HR any more.');
	return row;
}

export interface PendingDtr {
	id: string;
	establishmentId: string;
	establishmentName: string;
	establishmentSlug: string;
	month: string;
	submittedBy: string | null;
	submittedAt: Date | null;
}

export async function listSubmittedDtr(): Promise<PendingDtr[]> {
	const rows = await db
		.select({
			id: dtrSubmissions.id,
			establishmentId: dtrSubmissions.establishmentId,
			establishmentName: establishments.name,
			establishmentSlug: establishments.slug,
			cutoffStart: dtrSubmissions.cutoffStart,
			submittedBy: users.name,
			submittedAt: dtrSubmissions.submittedAt
		})
		.from(dtrSubmissions)
		.innerJoin(establishments, eq(establishments.id, dtrSubmissions.establishmentId))
		.leftJoin(users, eq(users.id, dtrSubmissions.submittedByUserId))
		.where(eq(dtrSubmissions.status, 'submitted'))
		.orderBy(asc(dtrSubmissions.submittedAt));
	return rows.map(({ cutoffStart, ...r }) => ({ ...r, month: cutoffStart.slice(0, 7) }));
}

export interface BoardRow {
	establishmentId: string;
	establishmentName: string;
	establishmentSlug: string;
	status: DtrStatus;
	id: string | null;
	note: string | null;
}

/** Every active establishment's DTR state for a month — who has not sent theirs yet. */
export async function dtrBoard(month: string): Promise<BoardRow[]> {
	const { start, end } = cutoff(month);
	const [ests, subs] = await Promise.all([
		db
			.select({ id: establishments.id, name: establishments.name, slug: establishments.slug })
			.from(establishments)
			.where(and(isNull(establishments.deletedAt), eq(establishments.status, 'active')))
			.orderBy(asc(establishments.name)),
		db
			.select()
			.from(dtrSubmissions)
			.where(and(eq(dtrSubmissions.cutoffStart, start), eq(dtrSubmissions.cutoffEnd, end)))
	]);
	const byEst = new Map(subs.map((s) => [s.establishmentId, s]));
	return ests.map((e) => {
		const s = byEst.get(e.id);
		return {
			establishmentId: e.id,
			establishmentName: e.name,
			establishmentSlug: e.slug,
			status: (s?.status as DtrStatus | undefined) ?? 'draft',
			id: s?.id ?? null,
			note: s?.decisionNote ?? null
		};
	});
}
