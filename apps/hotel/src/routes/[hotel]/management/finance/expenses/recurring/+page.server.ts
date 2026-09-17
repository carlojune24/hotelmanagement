import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { businessDateFor, FinanceError } from '$lib/server/finance/shared';
import { generateDueRecurringExpenses } from '$lib/server/finance/expenses';
import {
	createRecurringExpense,
	listExpenseCategories,
	listRecurringExpenses,
	listVendors,
	setRecurringExpenseActive
} from '$lib/server/finance/accounts';
import type { Actions, PageServerLoad } from './$types';

const CADENCES = ['weekly', 'monthly', 'quarterly', 'annually'] as const;

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	const hotel = locals.hotel!;
	const [rows, categories, vendors] = await Promise.all([
		listRecurringExpenses(hotel.id),
		listExpenseCategories(hotel.id),
		listVendors(hotel.id)
	]);
	const today = businessDateFor(hotel.timezone);
	return { rows, categories, vendors, today, cadences: CADENCES, dueCount: rows.filter((r) => r.isActive && r.nextDueOn <= today).length };
};

export const actions: Actions = {
	create: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'expense:create');
		const hotel = event.locals.hotel!;
		const parsed = z
			.object({
				categoryId: z.string().uuid(),
				vendorId: z.string().uuid().optional().or(z.literal('')),
				description: z.string().min(1).max(300),
				amount: z.coerce.number().positive(),
				isVatable: z.enum(['on']).optional(),
				cadence: z.enum(CADENCES),
				anchorDay: z.coerce.number().int().min(0).max(31),
				nextDueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
			})
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Check the template details.' });
		try {
			await createRecurringExpense(
				hotel.id,
				{
					categoryId: parsed.data.categoryId,
					vendorId: parsed.data.vendorId || null,
					description: parsed.data.description,
					amountCentavos: Math.round(parsed.data.amount * 100),
					isVatable: parsed.data.isVatable === 'on',
					cadence: parsed.data.cadence,
					anchorDay: parsed.data.anchorDay,
					nextDueOn: parsed.data.nextDueOn
				},
				event.locals.user
			);
			return { ok: 'Recurring expense saved.' };
		} catch (e) {
			if (e instanceof FinanceError) return fail(400, { error: e.message });
			throw e;
		}
	},

	toggle: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'expense:create');
		const hotel = event.locals.hotel!;
		const parsed = z
			.object({ id: z.string().uuid(), isActive: z.enum(['true', 'false']) })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Missing template.' });
		await setRecurringExpenseActive(hotel.id, parsed.data.id, parsed.data.isActive === 'true', event.locals.user);
		return { ok: 'Updated.' };
	},

	generateDue: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'expense:create');
		const hotel = event.locals.hotel!;
		const res = await generateDueRecurringExpenses(hotel.id, businessDateFor(hotel.timezone), event.locals.user);
		return { ok: res.created === 0 ? 'Nothing due.' : `${res.created} draft expense(s) created.` };
	}
};
