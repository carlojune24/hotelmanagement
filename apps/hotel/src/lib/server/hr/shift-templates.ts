import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { shiftTemplates } from '$lib/server/db/schema/index';
import { TEMPLATE_TAGS, shiftSpanMinutes, toHHMM } from '$lib/roster';

export class ShiftTemplateError extends Error {}

const hhmm = z.string().regex(/^\d{2}:\d{2}$/);

export const shiftTemplateFormSchema = z
	.object({
		name: z.string().trim().min(1, 'Give the shift a name.').max(40),
		isRestDay: z.boolean().default(false),
		startTime: hhmm.optional(),
		endTime: hhmm.optional(),
		breakMinutes: z.coerce.number().int().min(0).max(600).default(0),
		tag: z.enum(TEMPLATE_TAGS).default('neutral')
	})
	.superRefine((v, ctx) => {
		if (v.isRestDay) return;
		if (!v.startTime || !v.endTime || shiftSpanMinutes(v.startTime, v.endTime) === 0) {
			ctx.addIssue({
				code: 'custom',
				path: ['startTime'],
				message: 'Enter a start and end time that differ.'
			});
		}
	});
export type ShiftTemplateFormInput = z.infer<typeof shiftTemplateFormSchema>;

/** Offered, never auto-created — a hotel with no templates gets an empty state with this button. */
export const STARTER_TEMPLATES: ShiftTemplateFormInput[] = [
	{
		name: 'Morning',
		isRestDay: false,
		startTime: '07:00',
		endTime: '15:00',
		breakMinutes: 60,
		tag: 'neutral'
	},
	{
		name: 'Afternoon',
		isRestDay: false,
		startTime: '15:00',
		endTime: '23:00',
		breakMinutes: 60,
		tag: 'brand'
	},
	{
		name: 'Night',
		isRestDay: false,
		startTime: '23:00',
		endTime: '07:00',
		breakMinutes: 60,
		tag: 'warning'
	},
	{ name: 'Rest day', isRestDay: true, breakMinutes: 0, tag: 'neutral' }
];

export async function listShiftTemplates(hotelId: string) {
	const rows = await db
		.select()
		.from(shiftTemplates)
		.where(and(eq(shiftTemplates.hotelId, hotelId), isNull(shiftTemplates.deletedAt)))
		.orderBy(asc(shiftTemplates.sortOrder), asc(shiftTemplates.name));
	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		isRestDay: r.isRestDay,
		startTime: toHHMM(r.startTime),
		endTime: toHHMM(r.endTime),
		breakMinutes: r.breakMinutes,
		tag: r.tag
	}));
}

function toValues(input: ShiftTemplateFormInput) {
	return {
		name: input.name,
		isRestDay: input.isRestDay,
		startTime: input.isRestDay ? null : (input.startTime ?? null),
		endTime: input.isRestDay ? null : (input.endTime ?? null),
		breakMinutes: input.isRestDay ? 0 : input.breakMinutes,
		tag: input.tag
	};
}

/** Postgres unique-violation on the (hotel, name) index → a readable error. */
function rethrowDuplicate(e: unknown): never {
	const code =
		(e as { code?: string; cause?: { code?: string } })?.code ??
		(e as { cause?: { code?: string } })?.cause?.code;
	if (code === '23505') throw new ShiftTemplateError('A shift with that name already exists.');
	throw e;
}

export async function createShiftTemplate(hotelId: string, input: ShiftTemplateFormInput) {
	try {
		const [last] = await db
			.select({ next: sql<number>`coalesce(max(${shiftTemplates.sortOrder}), -1) + 1` })
			.from(shiftTemplates)
			.where(and(eq(shiftTemplates.hotelId, hotelId), isNull(shiftTemplates.deletedAt)));
		const [row] = await db
			.insert(shiftTemplates)
			.values({ hotelId, sortOrder: Number(last?.next ?? 0), ...toValues(input) })
			.returning();
		return row!;
	} catch (e) {
		rethrowDuplicate(e);
	}
}

/** Adds whichever starter shifts the hotel doesn't already have by name; returns how many were added. */
export async function addStarterTemplates(hotelId: string): Promise<number> {
	const existing = new Set((await listShiftTemplates(hotelId)).map((t) => t.name.toLowerCase()));
	let added = 0;
	for (const t of STARTER_TEMPLATES) {
		if (existing.has(t.name.toLowerCase())) continue;
		await createShiftTemplate(hotelId, t);
		added++;
	}
	return added;
}

/**
 * Editing a template never touches rosters already built from it — applying a template
 * copied its times into ordinary `schedules` rows.
 */
export async function updateShiftTemplate(
	hotelId: string,
	id: string,
	input: ShiftTemplateFormInput
) {
	try {
		const [row] = await db
			.update(shiftTemplates)
			.set({ ...toValues(input), updatedAt: new Date() })
			.where(
				and(
					eq(shiftTemplates.hotelId, hotelId),
					eq(shiftTemplates.id, id),
					isNull(shiftTemplates.deletedAt)
				)
			)
			.returning();
		if (!row) throw new ShiftTemplateError('Shift not found.');
		return row;
	} catch (e) {
		if (e instanceof ShiftTemplateError) throw e;
		rethrowDuplicate(e);
	}
}

export async function deleteShiftTemplate(hotelId: string, id: string) {
	const [row] = await db
		.update(shiftTemplates)
		.set({ deletedAt: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(shiftTemplates.hotelId, hotelId),
				eq(shiftTemplates.id, id),
				isNull(shiftTemplates.deletedAt)
			)
		)
		.returning({ id: shiftTemplates.id });
	if (!row) throw new ShiftTemplateError('Shift not found.');
}
