import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { employees, schedules } from '$lib/server/db/schema/index';

export const scheduleFormSchema = z.object({
	employeeId: z.string().uuid(),
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	isRestDay: z.coerce.boolean().default(false),
	startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
	endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
	breakMinutes: z.coerce.number().int().min(0).max(600).default(0)
});
export type ScheduleFormInput = z.infer<typeof scheduleFormSchema>;

/** Default one-week window when no range is given — a full roster is a lot of rows. */
export async function listSchedules(hotelId: string, from: string, to: string) {
	return db
		.select({
			id: schedules.id,
			employeeId: schedules.employeeId,
			employeeName: employees.firstName,
			employeeLastName: employees.lastName,
			date: schedules.date,
			isRestDay: schedules.isRestDay,
			startTime: schedules.startTime,
			endTime: schedules.endTime,
			breakMinutes: schedules.breakMinutes
		})
		.from(schedules)
		.innerJoin(employees, eq(employees.id, schedules.employeeId))
		.where(
			and(
				eq(schedules.hotelId, hotelId),
				isNull(schedules.deletedAt),
				gte(schedules.date, from),
				lte(schedules.date, to)
			)
		)
		.orderBy(asc(schedules.date), asc(employees.lastName));
}

export async function upsertSchedule(hotelId: string, input: ScheduleFormInput) {
	const values = {
		hotelId,
		employeeId: input.employeeId,
		date: input.date,
		isRestDay: input.isRestDay,
		startTime: input.isRestDay ? null : (input.startTime ?? null),
		endTime: input.isRestDay ? null : (input.endTime ?? null),
		breakMinutes: input.breakMinutes,
		updatedAt: new Date()
	};
	const [row] = await db
		.insert(schedules)
		.values(values)
		.onConflictDoUpdate({ target: [schedules.employeeId, schedules.date], set: values })
		.returning();
	return row!;
}

export async function deleteSchedule(hotelId: string, id: string) {
	await db.delete(schedules).where(and(eq(schedules.hotelId, hotelId), eq(schedules.id, id)));
}
