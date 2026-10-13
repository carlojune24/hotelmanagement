import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { schedulePeriods, schedules } from '$lib/server/db/schema/index';
import { addDays, mondayOf } from '$lib/roster';

export class PeriodError extends Error {}

export type WeekStatus = 'draft' | 'submitted' | 'approved' | 'returned';

export interface WeekInfo {
	weekStart: string;
	status: WeekStatus;
	note: string | null;
	submittedAt: Date | null;
	decidedAt: Date | null;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const blank = (weekStart: string): WeekInfo => ({
	weekStart,
	status: 'draft',
	note: null,
	submittedAt: null,
	decidedAt: null
});

/** Status of each given Monday; a week with no row is a plain draft. */
export async function weekStatuses(
	establishmentId: string,
	weekStarts: string[]
): Promise<Record<string, WeekInfo>> {
	const unique = [...new Set(weekStarts.map(mondayOf))];
	const out: Record<string, WeekInfo> = Object.fromEntries(unique.map((w) => [w, blank(w)]));
	if (unique.length === 0) return out;
	const rows = await db
		.select()
		.from(schedulePeriods)
		.where(and(eq(schedulePeriods.establishmentId, establishmentId), inArray(schedulePeriods.weekStart, unique)));
	for (const r of rows) {
		out[r.weekStart] = {
			weekStart: r.weekStart,
			status: r.status as WeekStatus,
			note: r.decisionNote,
			submittedAt: r.submittedAt,
			decidedAt: r.decidedAt
		};
	}
	return out;
}

export async function getWeek(establishmentId: string, weekStart: string): Promise<WeekInfo> {
	return (await weekStatuses(establishmentId, [weekStart]))[mondayOf(weekStart)]!;
}

function assertMonday(weekStart: string) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || mondayOf(weekStart) !== weekStart) {
		throw new PeriodError('A roster week starts on a Monday.');
	}
}

/** Manager → Main HR. Only a draft or a returned week can be sent, and only if something is rostered. */
export async function submitWeek(establishmentId: string, weekStart: string, userId: string | null) {
	assertMonday(weekStart);
	const current = await getWeek(establishmentId, weekStart);
	if (current.status === 'submitted') throw new PeriodError('This week is already waiting for approval.');
	if (current.status === 'approved') throw new PeriodError('This week is already approved.');

	const [{ n } = { n: 0 }] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(schedules)
		.where(
			and(
				eq(schedules.establishmentId, establishmentId),
				isNull(schedules.deletedAt),
				gte(schedules.date, weekStart),
				lte(schedules.date, addDays(weekStart, 6))
			)
		);
	if (n === 0) throw new PeriodError('Nothing is rostered this week yet.');

	const now = new Date();
	await db
		.insert(schedulePeriods)
		.values({
			establishmentId,
			weekStart,
			status: 'submitted',
			submittedByUserId: userId,
			submittedAt: now,
			decidedByUserId: null,
			decidedAt: null,
			decisionNote: null
		})
		.onConflictDoUpdate({
			target: [schedulePeriods.establishmentId, schedulePeriods.weekStart],
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

/** Main HR: approve, or send back with a note. Only a submitted week can be decided. */
export async function decideWeek(
	establishmentId: string,
	weekStart: string,
	decision: 'approved' | 'returned',
	note: string,
	userId: string | null
) {
	assertMonday(weekStart);
	if (decision === 'returned' && !note.trim()) {
		throw new PeriodError('Say what needs changing so the manager knows what to fix.');
	}
	const [row] = await db
		.update(schedulePeriods)
		.set({
			status: decision,
			decidedByUserId: userId,
			decidedAt: new Date(),
			decisionNote: note.trim() || null,
			updatedAt: new Date()
		})
		.where(
			and(
				eq(schedulePeriods.establishmentId, establishmentId),
				eq(schedulePeriods.weekStart, weekStart),
				eq(schedulePeriods.status, 'submitted')
			)
		)
		.returning();
	if (!row) throw new PeriodError('That week is not waiting for approval.');
	return row;
}

/**
 * Called inside every roster write. A manager changing a submitted or approved week sends it back
 * to draft — "approved" must always describe exactly what was approved. Main HR editing keeps the
 * state: it is the approver, and every edit is audit-logged by the caller.
 */
export async function touchWeeks(
	tx: Tx,
	establishmentId: string,
	dates: string[],
	byApprover: boolean
) {
	if (byApprover || dates.length === 0) return;
	const weeks = [...new Set(dates.map(mondayOf))];
	await tx
		.update(schedulePeriods)
		.set({
			status: 'draft',
			decidedByUserId: null,
			decidedAt: null,
			submittedAt: null,
			submittedByUserId: null,
			updatedAt: new Date()
		})
		.where(
			and(
				eq(schedulePeriods.establishmentId, establishmentId),
				inArray(schedulePeriods.weekStart, weeks),
				inArray(schedulePeriods.status, ['submitted', 'approved'])
			)
		);
}
