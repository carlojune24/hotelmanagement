import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { listCashAccounts } from '$lib/server/finance/accounts';
import {
	chargeBackShiftVariance,
	collectShiftChargeback,
	getShiftReconciliation,
	writeOffShiftChargeback
} from '$lib/server/finance/shifts';
import { FinanceError } from '$lib/server/finance/shared';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	const hotelId = locals.hotel!.id;
	const recon = await getShiftReconciliation(hotelId, params.shiftId);
	if (!recon) error(404, 'Shift not found');

	// Only relevant once there's a shortage to act on — skip the extra query otherwise.
	const cashAccounts =
		(recon.varianceCentavos ?? 0) < 0 ? await listCashAccounts(hotelId) : [];

	return { recon, cashAccounts };
};

export const actions: Actions = {
	chargeBack: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'finance:write');
		const hotelId = event.locals.hotel!.id;
		const parsed = z
			.object({
				amountCentavos: z.coerce.number().min(0).optional(),
				note: z.string().trim().min(1, 'Enter a note explaining the charge-back.').max(500)
			})
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' });
		}

		try {
			await chargeBackShiftVariance({
				hotelId,
				shiftId: event.params.shiftId,
				amountCentavos: parsed.data.amountCentavos != null ? Math.round(parsed.data.amountCentavos * 100) : undefined,
				note: parsed.data.note,
				actor: event.locals.user
			});
			return { ok: 'Shortage charged back to the cashier.' };
		} catch (e) {
			if (e instanceof FinanceError) return fail(400, { error: e.message });
			throw e;
		}
	},

	collect: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'finance:write');
		const hotelId = event.locals.hotel!.id;
		const parsed = z
			.object({ cashAccountId: z.string().uuid() })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Pick an account to receive the recovered cash.' });

		try {
			await collectShiftChargeback({
				hotelId,
				shiftId: event.params.shiftId,
				cashAccountId: parsed.data.cashAccountId,
				actor: event.locals.user
			});
			return { ok: 'Recovery recorded.' };
		} catch (e) {
			if (e instanceof FinanceError) return fail(400, { error: e.message });
			throw e;
		}
	},

	writeOff: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'finance:write');
		const hotelId = event.locals.hotel!.id;
		const parsed = z
			.object({ note: z.string().trim().min(1, 'Enter a reason for writing this off.').max(500) })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Enter a reason.' });
		}

		try {
			await writeOffShiftChargeback({
				hotelId,
				shiftId: event.params.shiftId,
				note: parsed.data.note,
				actor: event.locals.user
			});
			return { ok: 'Shortage written off.' };
		} catch (e) {
			if (e instanceof FinanceError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
