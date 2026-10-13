import { and, asc, desc, eq, gte, isNotNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { calendarDays } from '$lib/server/db/schema/index';
import { CALENDAR_KINDS } from '$lib/leave';

export class CalendarError extends Error {}

export const calendarFormSchema = z.object({
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the date.'),
	name: z.string().trim().min(1, 'Name the day, e.g. Charter Day.').max(80),
	kind: z.enum(CALENDAR_KINDS),
	/** Hours credited, blank = the whole scheduled day. */
	creditHours: z.preprocess(
		(v) => (v === '' || v === null || v === undefined ? null : v),
		z.coerce.number().min(0).max(24).nullable()
	),
	waiveLateness: z.boolean()
});
export type CalendarFormInput = z.infer<typeof calendarFormSchema>;

export type CalendarDay = typeof calendarDays.$inferSelect;

/** Approved days only by default — a proposal must never move a roster or a DTR. Settings passes
 *  `includePending` so Main HR can see what is waiting. */
export async function listCalendar(
	establishmentId: string,
	from: string,
	to: string,
	opts: { includePending?: boolean } = {}
): Promise<CalendarDay[]> {
	return db
		.select()
		.from(calendarDays)
		.where(
			and(
				eq(calendarDays.establishmentId, establishmentId),
				gte(calendarDays.date, from),
				lte(calendarDays.date, to),
				opts.includePending ? undefined : eq(calendarDays.status, 'approved')
			)
		)
		.orderBy(asc(calendarDays.date));
}

export async function saveCalendarDay(establishmentId: string, input: CalendarFormInput, id?: string) {
	const values = {
		date: input.date,
		name: input.name,
		kind: input.kind,
		creditMinutes: input.creditHours === null ? null : Math.round(input.creditHours * 60),
		waiveLateness: input.waiveLateness
	};
	const [dupe] = await db
		.select({ id: calendarDays.id })
		.from(calendarDays)
		.where(and(eq(calendarDays.establishmentId, establishmentId), eq(calendarDays.date, input.date)));
	if (dupe && dupe.id !== id) throw new CalendarError('That date already has an entry. Edit it instead.');

	if (!id) {
		const [row] = await db
			.insert(calendarDays)
			.values({ establishmentId, ...values })
			.returning();
		return row!;
	}
	const [row] = await db
		.update(calendarDays)
		.set({ ...values, updatedAt: new Date() })
		.where(and(eq(calendarDays.establishmentId, establishmentId), eq(calendarDays.id, id)))
		.returning();
	if (!row) throw new CalendarError('That entry no longer exists.');
	return row;
}

export async function deleteCalendarDay(establishmentId: string, id: string) {
	await db.delete(calendarDays).where(and(eq(calendarDays.establishmentId, establishmentId), eq(calendarDays.id, id)));
}

/** A manager's suggestion (a local holiday, a memo letting staff go early). It affects nothing
 *  until Main HR approves it. */
export async function proposeCalendarDay(
establishmentId: string,
input: CalendarFormInput,
userId: string | null,
note: string | null = null
) {
	const [dupe] = await db
		.select({ id: calendarDays.id })
		.from(calendarDays)
		.where(and(eq(calendarDays.establishmentId, establishmentId), eq(calendarDays.date, input.date)));
	if (dupe) throw new CalendarError('That date already has an entry or a pending proposal.');
	const [row] = await db
		.insert(calendarDays)
		.values({
			establishmentId,
			date: input.date,
			name: input.name,
			kind: input.kind,
			creditMinutes: input.creditHours === null ? null : Math.round(input.creditHours * 60),
			waiveLateness: input.waiveLateness,
status: 'submitted',
proposalNote: note?.trim() || null,
submittedByUserId: userId,
			submittedAt: new Date()
		})
		.returning();
	return row!;
}

/** Main HR: approve or reject a proposed day. */
export async function decideCalendarDay(
	id: string,
	decision: 'approved' | 'rejected',
	note: string,
	userId: string | null
) {
	if (decision === 'rejected' && !note.trim()) throw new CalendarError('Give a reason so they know why.');
	const [row] = await db
		.update(calendarDays)
		.set({
			status: decision,
			decidedByUserId: userId,
			decidedAt: new Date(),
			decisionNote: note.trim() || null,
			updatedAt: new Date()
		})
		.where(and(eq(calendarDays.id, id), eq(calendarDays.status, 'submitted')))
		.returning();
	if (!row) throw new CalendarError('That proposal is no longer waiting for approval.');
	return row;
}

/** What this establishment has sent to Main HR (newest first), with how each was decided. */
export async function listMemoProposals(establishmentId: string) {
	return db
		.select({
			id: calendarDays.id,
			date: calendarDays.date,
			name: calendarDays.name,
			kind: calendarDays.kind,
			creditMinutes: calendarDays.creditMinutes,
			waiveLateness: calendarDays.waiveLateness,
			status: calendarDays.status,
			proposalNote: calendarDays.proposalNote,
			decisionNote: calendarDays.decisionNote,
			submittedAt: calendarDays.submittedAt,
			decidedAt: calendarDays.decidedAt
		})
		.from(calendarDays)
		.where(and(eq(calendarDays.establishmentId, establishmentId), isNotNull(calendarDays.submittedAt)))
		.orderBy(desc(calendarDays.submittedAt));
}
