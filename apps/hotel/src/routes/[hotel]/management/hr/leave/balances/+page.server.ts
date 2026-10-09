import { fail } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { businessDateFor } from '$lib/server/finance/shared';
import { addAdjustment, adjustmentSchema, leaveBalances } from '$lib/server/hr/leave';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'leave:*');
	const hotel = locals.hotel!;
	const yearParam = Number(url.searchParams.get('year'));
	const year =
		Number.isInteger(yearParam) && yearParam >= 2000 && yearParam <= 2100
			? yearParam
			: Number(businessDateFor(hotel.timezone).slice(0, 4));
	const { types, rows } = await leaveBalances(hotel.id, year);
	return {
		year,
		types: types.map((t) => ({ id: t.id, code: t.code, name: t.name, daysPerYear: t.daysPerYear })),
		rows
	};
};

export const actions: Actions = {
	adjust: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'leave:*');
		const hotelId = event.locals.hotel!.id;
		const parsed = adjustmentSchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]!.message });
		const row = await addAdjustment(hotelId, parsed.data, event.locals.user?.id ?? null);
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'leave.adjust',
			entityType: 'leave_adjustment',
			entityId: row.id,
			after: parsed.data
		});
		return { ok: 'Balance adjusted.' };
	}
};
