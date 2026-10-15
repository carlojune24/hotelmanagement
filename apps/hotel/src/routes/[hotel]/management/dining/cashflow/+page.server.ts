import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { roleCan } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import { diningCashflowReport } from '$lib/server/dining-cashflow';
import { listCashAccounts } from '$lib/server/finance/accounts';
import { transferBetweenAccounts } from '$lib/server/finance/cash';
import { businessDateFor, FinanceError } from '$lib/server/finance/shared';
import { localParts } from '$lib/dining-slots';
import { addDays, resolveRange } from '$lib/dining-sales-range';
import type { Actions, PageServerLoad } from './$types';

const canSettle = (locals: App.Locals) =>
	!!locals.user?.isPlatformAdmin || (!!locals.role && roleCan(locals.role.capabilities, 'finance:write'));

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'dining:read');
	const hotel = locals.hotel!;
	const today = localParts(new Date(), hotel.timezone).date;
	const { from, to } = resolveRange(url, today);
	const report = await diningCashflowReport(hotel.id, from, to);

	const settle = canSettle(locals);
	// Only the bank / e-wallet accounts a payout can land in.
	const payoutTargets = settle
		? (await listCashAccounts(hotel.id)).filter((a) => a.kind === 'bank' || a.kind === 'e_wallet').map((a) => ({ id: a.id, name: a.name }))
		: [];

	return {
		from,
		to,
		today,
		report,
		canSettle: settle,
		payoutTargets,
		presets: {
			today: { from: today, to: today },
			week: { from: addDays(today, -6), to: today },
			month: { from: `${today.slice(0, 7)}-01`, to: today }
		}
	};
};

export const actions: Actions = {
	/** Moves PayMongo money from Undeposited Funds to a bank/e-wallet once the payout has landed. */
	recordPayout: async ({ locals, request }) => {
		requireCap(locals.user, locals.role, 'finance:write');
		const hotel = locals.hotel!;
		const parsed = z
			.object({
				toAccountId: z.string().uuid(),
				amount: z.coerce.number().positive(),
				memo: z.string().max(300).optional()
			})
			.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: 'Check the payout details.' });

		const report = await diningCashflowReport(hotel.id, '1970-01-01', '1970-01-01');
		const undeposited = report.awaitingPayout.undepositedAccountId;
		if (!undeposited) return fail(400, { error: 'Finance has no Undeposited Funds account set up.' });
		const amountCentavos = Math.round(parsed.data.amount * 100);
		if (amountCentavos > report.awaitingPayout.centavos) {
			return fail(400, { error: 'That is more than the dining money waiting for payout.' });
		}
		try {
			await transferBetweenAccounts({
				hotelId: hotel.id,
				businessDate: businessDateFor(hotel.timezone),
				fromAccountId: undeposited,
				toAccountId: parsed.data.toAccountId,
				amountCentavos,
				sourceType: 'dining_payout',
				memo: parsed.data.memo?.trim() || 'PayMongo payout (dining)',
				actor: locals.user
			});
			return { ok: 'Payout recorded.' };
		} catch (e) {
			if (e instanceof FinanceError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
