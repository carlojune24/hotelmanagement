import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireAnyCap } from '$lib/server/auth/rbac';
import { FinanceError } from '$lib/server/finance/shared';
import { diningDrawerId } from '$lib/server/finance/payments';
import { listCashAccounts, listExpenseCategories } from '$lib/server/finance/accounts';
import {
	addShiftEvent,
	closeShift,
	getOpenShiftForDrawer,
	getShiftReconciliation,
	listShifts,
	openShift as openShiftFn
} from '$lib/server/finance/shifts';
import { localParts } from '$lib/dining-slots';
import type { Actions, PageServerLoad } from './$types';

/** Dining's own till, or the hotel-wide drawer capability finance and the front desk hold. */
const DRAWER_CAPS = ['dining:shift', 'shift:write'];

/** The drawer this page may touch — dining's, never another register's. Everything below
 *  resolves it server-side, so no action can be pointed at the front desk's till. */
async function diningDrawer(hotelId: string) {
	const id = await diningDrawerId(hotelId);
	if (!id) return null;
	const account = (await listCashAccounts(hotelId)).find((a) => a.id === id);
	return account ? { id, name: account.name } : null;
}

export const load: PageServerLoad = async ({ locals }) => {
	requireAnyCap(locals.user, locals.role, DRAWER_CAPS);
	const hotel = locals.hotel!;

	const drawer = await diningDrawer(hotel.id);
	if (!drawer) return { drawer: null, recon: null, shifts: [], expenseCategories: [] };

	const open = await getOpenShiftForDrawer(hotel.id, drawer.id);
	const [recon, shifts, expenseCategories] = await Promise.all([
		open ? getShiftReconciliation(hotel.id, open.id) : null,
		listShifts(hotel.id, 30, drawer.id),
		listExpenseCategories(hotel.id)
	]);

	return {
		drawer,
		recon,
		shifts,
		expenseCategories: expenseCategories.map((c) => ({ id: c.id, name: c.name }))
	};
};

/** Dining's open shift, refusing anything that isn't on dining's own drawer. */
async function ownOpenShift(hotelId: string, shiftId: string) {
	const drawer = await diningDrawer(hotelId);
	if (!drawer) throw new FinanceError('No dining drawer is set up yet — Finance → Settings picks one.');
	const open = await getOpenShiftForDrawer(hotelId, drawer.id);
	if (!open || open.id !== shiftId) throw new FinanceError('That is not the dining drawer’s open shift.');
	return open;
}

const money = z.coerce.number().min(0).max(10_000_000);

export const actions: Actions = {
	openShift: async (event) => {
		requireAnyCap(event.locals.user, event.locals.role, DRAWER_CAPS);
		const hotel = event.locals.hotel!;
		const parsed = z
			.object({ openingFloat: money })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Enter the opening float.' });

		const drawer = await diningDrawer(hotel.id);
		if (!drawer)
			return fail(400, { error: 'No dining drawer is set up yet — Finance → Settings picks one.' });
		try {
			await openShiftFn({
				hotelId: hotel.id,
				cashAccountId: drawer.id,
				businessDate: localParts(new Date(), hotel.timezone).date,
				openingFloatCentavos: Math.round(parsed.data.openingFloat * 100),
				actor: event.locals.user
			});
			return { ok: 'Dining drawer opened.' };
		} catch (e) {
			if (e instanceof FinanceError) return fail(400, { error: e.message });
			throw e;
		}
	},

	shiftEvent: async (event) => {
		requireAnyCap(event.locals.user, event.locals.role, DRAWER_CAPS);
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
			const shift = await ownOpenShift(hotel.id, parsed.data.shiftId);
			await addShiftEvent({
				hotelId: hotel.id,
				shiftId: shift.id,
				kind: parsed.data.kind,
				amountCentavos: Math.round(parsed.data.amount * 100),
				direction: parsed.data.direction,
				reason: parsed.data.reason || null,
				expenseCategoryId:
					parsed.data.kind === 'payout' ? (parsed.data.expenseCategoryId ?? null) : null,
				isVatable: parsed.data.isVatable === '1',
				actor: event.locals.user
			});
			return { ok: 'Recorded.' };
		} catch (e) {
			if (e instanceof FinanceError) return fail(400, { error: e.message });
			throw e;
		}
	},

	closeShift: async (event) => {
		requireAnyCap(event.locals.user, event.locals.role, DRAWER_CAPS);
		const hotel = event.locals.hotel!;
		const parsed = z
			.object({ shiftId: z.string().uuid(), counted: money, notes: z.string().max(500).optional() })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Enter the counted cash.' });

		try {
			const shift = await ownOpenShift(hotel.id, parsed.data.shiftId);
			const r = await closeShift({
				hotelId: hotel.id,
				shiftId: shift.id,
				countedCentavos: Math.round(parsed.data.counted * 100),
				notes: parsed.data.notes || null,
				actor: event.locals.user
			});
			return {
				ok:
					r.varianceCentavos === 0
						? 'Dining drawer closed — balanced.'
						: `Dining drawer closed — ${r.varianceCentavos > 0 ? 'over' : 'short'} ₱${(Math.abs(r.varianceCentavos) / 100).toFixed(2)}.`
			};
		} catch (e) {
			if (e instanceof FinanceError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
