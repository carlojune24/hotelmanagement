import { fail } from '@sveltejs/kit';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { db } from '$lib/server/db/index';
import { establishments } from '$lib/server/db/schema/index';
import { getOrganization } from '$lib/server/establishments';
import { businessDateFor } from '$lib/server/time';
import {
	CalendarError,
	calendarFormSchema,
	deleteCalendarDay,
	listCompanyCalendar,
	saveCalendarDay
} from '$lib/server/hr/calendar';
import type { Actions, PageServerLoad } from './$types';

const TZ = 'Asia/Manila';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.access, 'leave:*');
	const org = await getOrganization();
	const asked = Number(url.searchParams.get('year'));
	const year = Number.isInteger(asked) && asked >= 2000 && asked <= 2100 ? asked : Number(businessDateFor(TZ).slice(0, 4));
	const [days, ests] = await Promise.all([
		listCompanyCalendar(org.id, `${year}-01-01`, `${year}-12-31`),
		db
			.select({ id: establishments.id, name: establishments.name })
			.from(establishments)
			.where(and(eq(establishments.organizationId, org.id), isNull(establishments.deletedAt)))
			.orderBy(asc(establishments.name))
	]);
	return {
		year,
		establishments: ests,
		days: days.map((d) => ({
			id: d.id,
			date: d.date,
			name: d.name,
			kind: d.kind,
			scope: d.scope as 'company' | 'selected',
			establishmentIds: d.establishmentIds,
			creditMinutes: d.creditMinutes,
			waiveLateness: d.waiveLateness
		}))
	};
};

export const actions: Actions = {
	saveDay: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'leave:*');
		try {
			const org = await getOrganization();
			const fd = await request.formData();
			const parsed = calendarFormSchema.safeParse({
				date: fd.get('date'),
				name: fd.get('name'),
				kind: fd.get('kind'),
				creditHours: fd.get('creditHours'),
				waiveLateness: fd.get('waiveLateness') === 'on',
				scope: fd.get('scope'),
				establishmentIds: fd.getAll('establishmentIds')
			});
			if (!parsed.success) return fail(400, { error: parsed.error.issues[0]!.message });
			const id = fd.get('id');
			const row = await saveCalendarDay(org.id, parsed.data, typeof id === 'string' && id ? id : undefined);
			await writeAudit({
				actor: locals.user,
				action: id ? 'calendar.update' : 'calendar.create',
				entityType: 'calendar_day',
				entityId: row.id,
				after: row
			});
			return { ok: `${row.name} saved. It applies to rosters, DTRs and payroll from now on; re-save a month's DTR to carry it over.` };
		} catch (e) {
			if (e instanceof CalendarError) return fail(400, { error: e.message });
			throw e;
		}
	},

	deleteDay: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'leave:*');
		const id = z.string().uuid().safeParse((await request.formData()).get('id'));
		if (!id.success) return fail(400, { error: 'Missing day.' });
		const org = await getOrganization();
		await deleteCalendarDay(org.id, id.data);
		await writeAudit({
			actor: locals.user,
			action: 'calendar.delete',
			entityType: 'calendar_day',
			entityId: id.data
		});
		return { ok: 'Removed from the calendar.' };
	}
};
