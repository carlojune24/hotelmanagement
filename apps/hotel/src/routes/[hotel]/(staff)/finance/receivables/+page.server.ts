import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { businessDateFor, FinanceError } from '$lib/server/finance/shared';
import { arAging, listReceivables, settleReceivable, writeOffReceivable } from '$lib/server/finance/receivables';
import type { Actions, PageServerLoad } from './$types';

const METHODS = ['cash', 'card', 'gcash', 'maya', 'bank_transfer', 'cheque'] as const;

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	const hotel = locals.hotel!;
	const today = businessDateFor(hotel.timezone);
	const show = url.searchParams.get('show') === 'all' ? 'all' : 'active';

	const [rows, aging] = await Promise.all([
		listReceivables(hotel.id, show === 'all' ? {} : { status: 'active' }),
		arAging(hotel.id, today)
	]);
	return { today, rows, aging, show, methods: METHODS };
};

export const actions: Actions = {
	settle: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'receivable:write');
		const hotel = event.locals.hotel!;
		const parsed = z
			.object({
				id: z.string().uuid(),
				method: z.enum(METHODS),
				amount: z.coerce.number().positive(),
				referenceNo: z.string().max(120).optional()
			})
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Check the collection details.' });
		try {
			await settleReceivable({
				hotelId: hotel.id,
				receivableId: parsed.data.id,
				method: parsed.data.method,
				amountCentavos: Math.round(parsed.data.amount * 100),
				referenceNo: parsed.data.referenceNo || null,
				actor: event.locals.user
			});
			return { ok: 'Collection recorded.' };
		} catch (e) {
			if (e instanceof FinanceError) return fail(400, { error: e.message });
			throw e;
		}
	},

	writeOff: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'receivable:write');
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotel = event.locals.hotel!;
		const parsed = z
			.object({ id: z.string().uuid(), reason: z.string().min(1).max(300) })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'A write-off needs a reason.' });
		try {
			await writeOffReceivable(hotel.id, parsed.data.id, parsed.data.reason, event.locals.user);
			return { ok: 'Written off.' };
		} catch (e) {
			if (e instanceof FinanceError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
