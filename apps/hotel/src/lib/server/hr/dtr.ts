import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { dtrEntries, employees } from '$lib/server/db/schema/index';

export const dtrFormSchema = z.object({
	employeeId: z.string().uuid(),
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	timeIn: z.string().optional(),
	timeOut: z.string().optional(),
	workedMinutes: z.coerce.number().int().min(0).max(1440).default(0),
	otMinutes: z.coerce.number().int().min(0).max(1440).default(0),
	nightDiffMinutes: z.coerce.number().int().min(0).max(1440).default(0),
	tardinessMinutes: z.coerce.number().int().min(0).max(1440).default(0),
	undertimeMinutes: z.coerce.number().int().min(0).max(1440).default(0),
	isAbsent: z.coerce.boolean().default(false),
	correctionNote: z.string().trim().max(500).optional()
});
export type DtrFormInput = z.infer<typeof dtrFormSchema>;

export async function listDtrEntries(hotelId: string, from: string, to: string) {
	return db
		.select({
			id: dtrEntries.id,
			employeeId: dtrEntries.employeeId,
			employeeName: employees.firstName,
			employeeLastName: employees.lastName,
			date: dtrEntries.date,
			timeIn: dtrEntries.timeIn,
			timeOut: dtrEntries.timeOut,
			workedMinutes: dtrEntries.workedMinutes,
			otMinutes: dtrEntries.otMinutes,
			nightDiffMinutes: dtrEntries.nightDiffMinutes,
			tardinessMinutes: dtrEntries.tardinessMinutes,
			undertimeMinutes: dtrEntries.undertimeMinutes,
			isAbsent: dtrEntries.isAbsent,
			source: dtrEntries.source
		})
		.from(dtrEntries)
		.innerJoin(employees, eq(employees.id, dtrEntries.employeeId))
		.where(
			and(
				eq(dtrEntries.hotelId, hotelId),
				isNull(dtrEntries.deletedAt),
				gte(dtrEntries.date, from),
				lte(dtrEntries.date, to)
			)
		)
		.orderBy(asc(dtrEntries.date), asc(employees.lastName));
}

/** Manual entry/correction — biometric import (ZKTeco `ATTLOG.TXT` → `pair-punches.ts`)
 *  is a separate, not-yet-built path (docs/TODO.md) that would write `source: 'biometric'`
 *  rows instead. */
export async function upsertManualDtrEntry(
	hotelId: string,
	input: DtrFormInput,
	correctedByUserId: string | null
) {
	const values = {
		hotelId,
		employeeId: input.employeeId,
		date: input.date,
		timeIn: input.timeIn ? new Date(`${input.date}T${input.timeIn}:00`) : null,
		timeOut: input.timeOut ? new Date(`${input.date}T${input.timeOut}:00`) : null,
		workedMinutes: input.workedMinutes,
		otMinutes: input.otMinutes,
		nightDiffMinutes: input.nightDiffMinutes,
		tardinessMinutes: input.tardinessMinutes,
		undertimeMinutes: input.undertimeMinutes,
		isAbsent: input.isAbsent,
		source: 'manual' as const,
		correctedByUserId,
		correctionNote: input.correctionNote || null,
		updatedAt: new Date()
	};

	const existing = await db
		.select({ id: dtrEntries.id })
		.from(dtrEntries)
		.where(
			and(
				eq(dtrEntries.hotelId, hotelId),
				eq(dtrEntries.employeeId, input.employeeId),
				eq(dtrEntries.date, input.date)
			)
		)
		.then((r) => r.at(0));

	if (existing) {
		const [row] = await db.update(dtrEntries).set(values).where(eq(dtrEntries.id, existing.id)).returning();
		return row!;
	}
	const [row] = await db.insert(dtrEntries).values(values).returning();
	return row!;
}

export async function deleteDtrEntry(hotelId: string, id: string) {
	await db.delete(dtrEntries).where(and(eq(dtrEntries.hotelId, hotelId), eq(dtrEntries.id, id)));
}
