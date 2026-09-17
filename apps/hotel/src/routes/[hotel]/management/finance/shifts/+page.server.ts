import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { FinanceError } from '$lib/server/finance/shared';
import { addShiftEvent, closeShift, getShiftReconciliation, listShifts } from '$lib/server/finance/shifts';
import { listExpenseCategories } from '$lib/server/finance/accounts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	const hotel = locals.hotel!;
	const [shifts, expenseCategories] = await Promise.all([
		listShifts(hotel.id, 80),
		listExpenseCategories(hotel.id)
	]);
	const openIds = shifts.filter((s) => s.status === 'open').map((s) => s.id);
	const reconciliations = await Promise.all(openIds.map((id) => getShiftReconciliation(hotel.id, id)));
	return {
		shifts,
		expenseCategories: expenseCategories.map((c) => ({ id: c.id, name: c.name, group: c.group })),
		openReconciliations: reconciliations.filter((r): r is NonNullable<typeof r> => !!r)
	};
};

export const actions: Actions = {
	closeShift: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'shift:write');
		const hotel = event.locals.hotel!;
		const parsed = z
			.object({
				shiftId: z.string().uuid(),
				counted: z.coerce.number().min(0),
				notes: z.string().max(500).optional()
			})
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Enter the counted cash.' });
		try {
			const res = await closeShift({
				hotelId: hotel.id,
				shiftId: parsed.data.shiftId,
				countedCentavos: Math.round(parsed.data.counted * 100),
				notes: parsed.data.notes || null,
				actor: event.locals.user
			});
			return {
				ok:
					res.varianceCentavos === 0
						? 'Shift closed — balanced.'
						: `Shift closed — ${res.varianceCentavos > 0 ? 'over' : 'short'} ₱${(Math.abs(res.varianceCentavos) / 100).toFixed(2)}.`
			};
		} catch (e) {
			if (e instanceof FinanceError) return fail(400, { error: e.message });
			throw e;
		}
	},

	shiftEvent: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'shift:write');
		const hotel = event.locals.hotel!;
		const parsed = z
			.object({
				shiftId: z.string().uuid(),
				kind: z.enum(['payout', 'cash_drop', 'pickup', 'adjustment']),
				amount: z.coerce.number().positive(),
				direction: z.enum(['in', 'out']).optional(),
				reason: z.string().max(300).optional(),
				expenseCategoryId: z.string().uuid().optional(),
				isVatable: z.enum(['1']).optional()
			})
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Check the amount.' });
		try {
			await addShiftEvent({
				hotelId: hotel.id,
				shiftId: parsed.data.shiftId,
				kind: parsed.data.kind,
				amountCentavos: Math.round(parsed.data.amount * 100),
				direction: parsed.data.direction,
				reason: parsed.data.reason || null,
				expenseCategoryId: parsed.data.kind === 'payout' ? (parsed.data.expenseCategoryId ?? null) : null,
				isVatable: parsed.data.isVatable === '1',
				actor: event.locals.user
			});
			return { ok: 'Recorded.' };
		} catch (e) {
			if (e instanceof FinanceError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
