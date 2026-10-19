import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { calendarDayEstablishments, calendarDays, establishments } from '$lib/server/db/schema/index';
import { CALENDAR_KINDS } from '$lib/leave';

export class CalendarError extends Error {}

export const CALENDAR_SCOPES = ['company', 'selected'] as const;

export const calendarFormSchema = z
	.object({
		date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the date.'),
		name: z.string().trim().min(1, 'Name the day, e.g. Charter Day.').max(80),
		kind: z.enum(CALENDAR_KINDS),
		/** Hours credited, blank = the whole scheduled day. */
		creditHours: z.preprocess(
			(v) => (v === '' || v === null || v === undefined ? null : v),
			z.coerce.number().min(0).max(24).nullable()
		),
		waiveLateness: z.boolean(),
		/** The whole company, or only the establishments in `establishmentIds`. */
		scope: z.enum(CALENDAR_SCOPES),
		establishmentIds: z.array(z.string().uuid()).default([])
	})
	.refine((v) => v.scope === 'company' || v.establishmentIds.length > 0, {
		message: 'Choose at least one establishment, or apply it to the whole company.',
		path: ['establishmentIds']
	});
export type CalendarFormInput = z.infer<typeof calendarFormSchema>;

export type CalendarDay = typeof calendarDays.$inferSelect & { establishmentIds: string[] };

/** A holiday or memo as one establishment sees it on one date. */
export interface EffectiveDay {
	id: string;
	establishmentId: string;
	date: string;
	name: string;
	kind: string;
	creditMinutes: number | null;
	waiveLateness: boolean;
}

/**
 * What applies to each of `establishmentIds` between `from` and `to`: company-wide days plus the days that
 * list the establishment. When both exist on a date the one made for that establishment wins, so a local
 * memo can refine a company holiday. A day Main HR just saved is in effect at once.
 */
export async function effectiveCalendar(establishmentIds: string[], from: string, to: string): Promise<EffectiveDay[]> {
	if (establishmentIds.length === 0) return [];
	const ests = await db
		.select({ id: establishments.id, organizationId: establishments.organizationId })
		.from(establishments)
		.where(inArray(establishments.id, establishmentIds));
	if (ests.length === 0) return [];
	const orgIds = [...new Set(ests.map((e) => e.organizationId))];

	const days = await db
		.select()
		.from(calendarDays)
		.where(and(inArray(calendarDays.organizationId, orgIds), gte(calendarDays.date, from), lte(calendarDays.date, to)))
		.orderBy(asc(calendarDays.date), asc(calendarDays.createdAt));
	if (days.length === 0) return [];
	const links = await db
		.select()
		.from(calendarDayEstablishments)
		.where(
			inArray(
				calendarDayEstablishments.calendarDayId,
				days.filter((d) => d.scope === 'selected').map((d) => d.id)
			)
		);
	const listed = new Map<string, Set<string>>();
	for (const l of links) {
		const set = listed.get(l.calendarDayId) ?? new Set<string>();
		set.add(l.establishmentId);
		listed.set(l.calendarDayId, set);
	}

	const out: EffectiveDay[] = [];
	for (const est of ests) {
		const byDate = new Map<string, { day: (typeof days)[number]; specific: boolean }>();
		for (const d of days) {
			if (d.organizationId !== est.organizationId) continue;
			const specific = d.scope === 'selected';
			if (specific && !listed.get(d.id)?.has(est.id)) continue;
			const have = byDate.get(d.date);
			if (!have || (specific && !have.specific)) byDate.set(d.date, { day: d, specific });
		}
		for (const { day } of byDate.values()) {
			out.push({
				id: day.id,
				establishmentId: est.id,
				date: day.date,
				name: day.name,
				kind: day.kind,
				creditMinutes: day.creditMinutes,
				waiveLateness: day.waiveLateness
			});
		}
	}
	return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** What one establishment observes between two dates, for its roster, DTR and dashboard. */
export async function listCalendar(establishmentId: string, from: string, to: string): Promise<EffectiveDay[]> {
	return effectiveCalendar([establishmentId], from, to);
}

/** Main HR's list: every entry of the company for the year, with the establishments each one is limited to. */
export async function listCompanyCalendar(organizationId: string, from: string, to: string): Promise<CalendarDay[]> {
	const days = await db
		.select()
		.from(calendarDays)
		.where(and(eq(calendarDays.organizationId, organizationId), gte(calendarDays.date, from), lte(calendarDays.date, to)))
		.orderBy(asc(calendarDays.date), asc(calendarDays.name));
	if (days.length === 0) return [];
	const links = await db
		.select()
		.from(calendarDayEstablishments)
		.where(inArray(calendarDayEstablishments.calendarDayId, days.map((d) => d.id)));
	const of = new Map<string, string[]>();
	for (const l of links) of.set(l.calendarDayId, [...(of.get(l.calendarDayId) ?? []), l.establishmentId]);
	return days.map((d) => ({ ...d, establishmentIds: of.get(d.id) ?? [] }));
}

/** Two entries may not reach the same establishment on the same date — except a company day with one made for the establishment. */
async function assertNoClash(organizationId: string, input: CalendarFormInput, id: string | undefined) {
	const others = (await listCompanyCalendar(organizationId, input.date, input.date)).filter((d) => d.id !== id);
	if (input.scope === 'company') {
		if (others.some((d) => d.scope === 'company')) {
			throw new CalendarError('The whole company already has an entry on that date. Edit it instead.');
		}
		return;
	}
	const taken = new Set(others.filter((d) => d.scope === 'selected').flatMap((d) => d.establishmentIds));
	const clash = input.establishmentIds.filter((e) => taken.has(e));
	if (clash.length > 0) {
		const names = await db
			.select({ name: establishments.name })
			.from(establishments)
			.where(inArray(establishments.id, clash));
		throw new CalendarError(`${names.map((n) => n.name).join(', ')} already has an entry on that date. Edit it instead.`);
	}
}

export async function saveCalendarDay(organizationId: string, input: CalendarFormInput, id?: string) {
	if (input.scope === 'selected') {
		const valid = await db
			.select({ id: establishments.id })
			.from(establishments)
			.where(and(eq(establishments.organizationId, organizationId), inArray(establishments.id, input.establishmentIds)));
		if (valid.length !== new Set(input.establishmentIds).size) {
			throw new CalendarError('One of the chosen establishments is not part of this company.');
		}
	}
	await assertNoClash(organizationId, input, id);

	const values = {
		date: input.date,
		name: input.name,
		kind: input.kind,
		scope: input.scope,
		creditMinutes: input.creditHours === null ? null : Math.round(input.creditHours * 60),
		waiveLateness: input.waiveLateness
	};
	return db.transaction(async (tx) => {
		let row: typeof calendarDays.$inferSelect | undefined;
		if (!id) {
			[row] = await tx
				.insert(calendarDays)
				.values({ organizationId, ...values })
				.returning();
		} else {
			[row] = await tx
				.update(calendarDays)
				.set({ ...values, updatedAt: new Date() })
				.where(and(eq(calendarDays.organizationId, organizationId), eq(calendarDays.id, id)))
				.returning();
			if (!row) throw new CalendarError('That entry no longer exists.');
			await tx.delete(calendarDayEstablishments).where(eq(calendarDayEstablishments.calendarDayId, id));
		}
		if (input.scope === 'selected') {
			await tx
				.insert(calendarDayEstablishments)
				.values([...new Set(input.establishmentIds)].map((establishmentId) => ({ calendarDayId: row!.id, establishmentId })));
		}
		return { ...row!, establishmentIds: input.scope === 'selected' ? [...new Set(input.establishmentIds)] : [] };
	});
}

export async function deleteCalendarDay(organizationId: string, id: string) {
	await db.delete(calendarDays).where(and(eq(calendarDays.organizationId, organizationId), eq(calendarDays.id, id)));
}
