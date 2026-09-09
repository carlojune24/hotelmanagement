import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { businessDateFor, FinanceError } from '$lib/server/finance/shared';
import {
	getCashPosition,
	listMovements,
	recordManualMovement,
	transferBetweenAccounts,
	voidCashMovement
} from '$lib/server/finance/cash';
import { listCashAccounts } from '$lib/server/finance/accounts';
import type { Actions, PageServerLoad } from './$types';

const MANUAL_CATEGORIES = [
	'other_revenue',
	'owner_contribution',
	'owner_draw',
	'adjustment',
	'expense',
	'statutory_remittance'
] as const;

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	const hotel = locals.hotel!;
	const today = businessDateFor(hotel.timezone);
	const from = url.searchParams.get('from') || undefined;
	const to = url.searchParams.get('to') || undefined;
	const accountId = url.searchParams.get('account') || undefined;
	const direction = (url.searchParams.get('direction') as 'in' | 'out' | null) || undefined;

	const [accounts, movements, position] = await Promise.all([
		listCashAccounts(hotel.id, { includeInactive: true }),
		listMovements(hotel.id, { from, to, cashAccountId: accountId, direction, limit: 400 }),
		getCashPosition(hotel.id, from && to ? { from, to } : undefined)
	]);

	return {
		today,
		accounts,
		activeAccounts: accounts.filter((a) => a.isActive && !a.deletedAt),
		movements,
		position,
		manualCategories: MANUAL_CATEGORIES,
		filters: { from: from ?? '', to: to ?? '', account: accountId ?? '', direction: direction ?? '' }
	};
};

export const actions: Actions = {
	transfer: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'finance:write');
		const hotel = event.locals.hotel!;
		const parsed = z
			.object({
				fromAccountId: z.string().uuid(),
				toAccountId: z.string().uuid(),
				amount: z.coerce.number().positive(),
				isBankDeposit: z.enum(['1']).optional(),
				memo: z.string().max(300).optional()
			})
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Check the transfer details.' });
		try {
			await transferBetweenAccounts({
				hotelId: hotel.id,
				businessDate: businessDateFor(hotel.timezone),
				fromAccountId: parsed.data.fromAccountId,
				toAccountId: parsed.data.toAccountId,
				amountCentavos: Math.round(parsed.data.amount * 100),
				isBankDeposit: parsed.data.isBankDeposit === '1',
				memo: parsed.data.memo || null,
				actor: event.locals.user
			});
			return { ok: 'Transfer recorded.' };
		} catch (e) {
			if (e instanceof FinanceError) return fail(400, { error: e.message });
			throw e;
		}
	},

	manualMovement: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'finance:write');
		const hotel = event.locals.hotel!;
		const parsed = z
			.object({
				direction: z.enum(['in', 'out']),
				category: z.enum(MANUAL_CATEGORIES),
				cashAccountId: z.string().uuid(),
				amount: z.coerce.number().positive(),
				counterpartyName: z.string().max(200).optional(),
				memo: z.string().max(300).optional(),
				businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
			})
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Check the movement details.' });
		try {
			await recordManualMovement({
				hotelId: hotel.id,
				businessDate: parsed.data.businessDate,
				direction: parsed.data.direction,
				category: parsed.data.category,
				cashAccountId: parsed.data.cashAccountId,
				amountCentavos: Math.round(parsed.data.amount * 100),
				counterpartyName: parsed.data.counterpartyName || null,
				memo: parsed.data.memo || null,
				actor: event.locals.user
			});
			return { ok: 'Movement recorded.' };
		} catch (e) {
			if (e instanceof FinanceError) return fail(400, { error: e.message });
			throw e;
		}
	},

	voidMovement: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotel = event.locals.hotel!;
		const parsed = z
			.object({ movementId: z.string().uuid(), reason: z.string().max(300).optional() })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Missing movement.' });
		try {
			await voidCashMovement(hotel.id, parsed.data.movementId, parsed.data.reason ?? null, event.locals.user);
			return { ok: 'Movement voided.' };
		} catch (e) {
			if (e instanceof FinanceError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
