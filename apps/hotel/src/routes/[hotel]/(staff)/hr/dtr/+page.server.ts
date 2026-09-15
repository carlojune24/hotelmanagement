import { fail } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { deleteDtrEntry, dtrFormSchema, listDtrEntries, upsertManualDtrEntry } from '$lib/server/hr/dtr';
import { listEmployees } from '$lib/server/hr/employees';
import type { Actions, PageServerLoad } from './$types';

function startOfWeek(d: Date): Date {
	const day = d.getUTCDay();
	const diff = (day + 6) % 7;
	const monday = new Date(d);
	monday.setUTCDate(d.getUTCDate() - diff);
	return monday;
}

function toDateStr(d: Date): string {
	return d.toISOString().slice(0, 10);
}

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'dtr:*');
	const hotelId = locals.hotel!.id;

	const anchor = url.searchParams.get('week');
	const monday = startOfWeek(anchor ? new Date(`${anchor}T00:00:00Z`) : new Date());
	const sunday = new Date(monday);
	sunday.setUTCDate(monday.getUTCDate() + 6);
	const from = toDateStr(monday);
	const to = toDateStr(sunday);

	const [entries, employees] = await Promise.all([listDtrEntries(hotelId, from, to), listEmployees(hotelId)]);

	return { entries, employees, weekStart: from, weekEnd: to };
};

export const actions: Actions = {
	save: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dtr:*');
		const hotelId = event.locals.hotel!.id;

		const raw = Object.fromEntries(await event.request.formData());
		const parsed = dtrFormSchema.safeParse({ ...raw, isAbsent: raw.isAbsent === 'on' });
		if (!parsed.success) return fail(400, { error: 'Check the DTR entry and try again.' });

		const entry = await upsertManualDtrEntry(hotelId, parsed.data, event.locals.user?.id ?? null);
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'dtr.save',
			entityType: 'dtr_entry',
			entityId: entry.id,
			after: parsed.data
		});
		return { ok: 'DTR entry saved.' };
	},

	delete: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dtr:*');
		const hotelId = event.locals.hotel!.id;

		const fd = await event.request.formData();
		const id = fd.get('id');
		if (typeof id !== 'string') return fail(400, { error: 'Missing DTR entry.' });

		await deleteDtrEntry(hotelId, id);
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'dtr.delete',
			entityType: 'dtr_entry',
			entityId: id
		});
		return { ok: 'DTR entry removed.' };
	}
};
