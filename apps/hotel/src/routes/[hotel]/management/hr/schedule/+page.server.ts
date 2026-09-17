import { fail } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { deleteSchedule, listSchedules, scheduleFormSchema, upsertSchedule } from '$lib/server/hr/schedules';
import { listEmployees } from '$lib/server/hr/employees';
import type { Actions, PageServerLoad } from './$types';

function startOfWeek(d: Date): Date {
	const day = d.getUTCDay();
	const diff = (day + 6) % 7; // Monday-start
	const monday = new Date(d);
	monday.setUTCDate(d.getUTCDate() - diff);
	return monday;
}

function toDateStr(d: Date): string {
	return d.toISOString().slice(0, 10);
}

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'schedule:*');
	const hotelId = locals.hotel!.id;

	const anchor = url.searchParams.get('week');
	const monday = startOfWeek(anchor ? new Date(`${anchor}T00:00:00Z`) : new Date());
	const sunday = new Date(monday);
	sunday.setUTCDate(monday.getUTCDate() + 6);
	const from = toDateStr(monday);
	const to = toDateStr(sunday);

	const [entries, employees] = await Promise.all([listSchedules(hotelId, from, to), listEmployees(hotelId)]);

	return { entries, employees, weekStart: from, weekEnd: to };
};

export const actions: Actions = {
	save: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'schedule:*');
		const hotelId = event.locals.hotel!.id;

		const raw = Object.fromEntries(await event.request.formData());
		const parsed = scheduleFormSchema.safeParse({ ...raw, isRestDay: raw.isRestDay === 'on' });
		if (!parsed.success) return fail(400, { error: 'Check the schedule details and try again.' });

		const entry = await upsertSchedule(hotelId, parsed.data);
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'schedule.save',
			entityType: 'schedule',
			entityId: entry.id,
			after: parsed.data
		});
		return { ok: 'Schedule saved.' };
	},

	delete: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'schedule:*');
		const hotelId = event.locals.hotel!.id;

		const fd = await event.request.formData();
		const id = fd.get('id');
		if (typeof id !== 'string') return fail(400, { error: 'Missing schedule entry.' });

		await deleteSchedule(hotelId, id);
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'schedule.delete',
			entityType: 'schedule',
			entityId: id
		});
		return { ok: 'Schedule entry removed.' };
	}
};
