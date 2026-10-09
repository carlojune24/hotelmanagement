import { and, asc, eq, gte, lte } from 'drizzle-orm';
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

export async function listCalendar(hotelId: string, from: string, to: string): Promise<CalendarDay[]> {
	return db
		.select()
		.from(calendarDays)
		.where(and(eq(calendarDays.hotelId, hotelId), gte(calendarDays.date, from), lte(calendarDays.date, to)))
		.orderBy(asc(calendarDays.date));
}

export async function saveCalendarDay(hotelId: string, input: CalendarFormInput, id?: string) {
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
		.where(and(eq(calendarDays.hotelId, hotelId), eq(calendarDays.date, input.date)));
	if (dupe && dupe.id !== id) throw new CalendarError('That date already has an entry. Edit it instead.');

	if (!id) {
		const [row] = await db
			.insert(calendarDays)
			.values({ hotelId, ...values })
			.returning();
		return row!;
	}
	const [row] = await db
		.update(calendarDays)
		.set({ ...values, updatedAt: new Date() })
		.where(and(eq(calendarDays.hotelId, hotelId), eq(calendarDays.id, id)))
		.returning();
	if (!row) throw new CalendarError('That entry no longer exists.');
	return row;
}

export async function deleteCalendarDay(hotelId: string, id: string) {
	await db.delete(calendarDays).where(and(eq(calendarDays.hotelId, hotelId), eq(calendarDays.id, id)));
}
