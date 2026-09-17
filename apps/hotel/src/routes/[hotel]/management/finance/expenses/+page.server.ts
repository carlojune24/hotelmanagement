import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { businessDateFor, FinanceError } from '$lib/server/finance/shared';
import {
	approveExpense,
	createExpense,
	listExpenses,
	markExpensePaid,
	voidExpense
} from '$lib/server/finance/expenses';
import { listCashAccounts, listExpenseCategories, listVendors } from '$lib/server/finance/accounts';
import { saveUpload, UploadValidationError } from '$lib/server/uploads';
import type { Actions, PageServerLoad } from './$types';

const PAY_METHODS = ['cash', 'card', 'gcash', 'maya', 'bank_transfer', 'cheque'] as const;
const STATUSES = ['draft', 'approved', 'paid', 'void'] as const;

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	const hotel = locals.hotel!;
	const today = businessDateFor(hotel.timezone);
	const status = STATUSES.includes(url.searchParams.get('status') as never)
		? (url.searchParams.get('status') as (typeof STATUSES)[number])
		: undefined;
	const from = url.searchParams.get('from') || undefined;
	const to = url.searchParams.get('to') || undefined;

	const [rows, categories, vendors, accounts] = await Promise.all([
		listExpenses(hotel.id, { status, from, to, limit: 400 }),
		listExpenseCategories(hotel.id),
		listVendors(hotel.id),
		listCashAccounts(hotel.id)
	]);

	return {
		today,
		rows,
		categories,
		vendors,
		accounts,
		payMethods: PAY_METHODS,
		filters: { status: status ?? '', from: from ?? '', to: to ?? '' },
		totals: {
			gross: rows.reduce((s, r) => s + r.grossCentavos, 0),
			vat: rows.reduce((s, r) => s + r.inputVatCentavos, 0)
		}
	};
};

export const actions: Actions = {
	create: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'expense:create');
		const hotel = event.locals.hotel!;
		const fd = await event.request.formData();
		const parsed = z
			.object({
				expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
				categoryId: z.string().uuid(),
				vendorId: z.string().uuid().optional().or(z.literal('')),
				description: z.string().min(1).max(300),
				vendorInvoiceNo: z.string().max(120).optional(),
				gross: z.coerce.number().positive(),
				isVatable: z.enum(['on']).optional(),
				withholdingTax: z.coerce.number().min(0).optional(),
				notes: z.string().max(1000).optional()
			})
			.safeParse(Object.fromEntries(fd));
		if (!parsed.success) return fail(400, { error: 'Check the expense details.' });

		let attachmentUrl: string | null = null;
		const file = fd.get('attachment');
		if (file instanceof File && file.size > 0) {
			try {
				attachmentUrl = await saveUpload(hotel.id, file, 'image');
			} catch (e) {
				if (e instanceof UploadValidationError) return fail(400, { error: e.message });
				throw e;
			}
		}

		try {
			await createExpense({
				hotelId: hotel.id,
				expenseDate: parsed.data.expenseDate,
				categoryId: parsed.data.categoryId,
				vendorId: parsed.data.vendorId || null,
				description: parsed.data.description,
				vendorInvoiceNo: parsed.data.vendorInvoiceNo || null,
				grossCentavos: Math.round(parsed.data.gross * 100),
				isVatable: parsed.data.isVatable === 'on',
				withholdingTaxCentavos: Math.round((parsed.data.withholdingTax ?? 0) * 100),
				notes: parsed.data.notes || null,
				attachmentUrl,
				actor: event.locals.user
			});
			return { ok: 'Expense recorded.' };
		} catch (e) {
			if (e instanceof FinanceError) return fail(400, { error: e.message });
			throw e;
		}
	},

	approve: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'expense:approve');
		const hotel = event.locals.hotel!;
		const id = (await event.request.formData()).get('id');
		if (typeof id !== 'string') return fail(400, { error: 'Missing expense.' });
		try {
			await approveExpense(hotel.id, id, event.locals.user);
			return { ok: 'Expense approved.' };
		} catch (e) {
			if (e instanceof FinanceError) return fail(400, { error: e.message });
			throw e;
		}
	},

	pay: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'expense:pay');
		const hotel = event.locals.hotel!;
		const parsed = z
			.object({
				id: z.string().uuid(),
				paidFromAccountId: z.string().uuid(),
				paymentMethod: z.enum(PAY_METHODS),
				paymentReferenceNo: z.string().max(120).optional(),
				paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
			})
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Pick an account and method.' });
		try {
			await markExpensePaid({
				hotelId: hotel.id,
				expenseId: parsed.data.id,
				paidFromAccountId: parsed.data.paidFromAccountId,
				paymentMethod: parsed.data.paymentMethod,
				paymentReferenceNo: parsed.data.paymentReferenceNo || null,
				paidOn: parsed.data.paidOn || null,
				actor: event.locals.user
			});
			return { ok: 'Expense marked paid.' };
		} catch (e) {
			if (e instanceof FinanceError) return fail(400, { error: e.message });
			throw e;
		}
	},

	void: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'expense:void');
		const hotel = event.locals.hotel!;
		const parsed = z
			.object({ id: z.string().uuid(), reason: z.string().min(1).max(300) })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'A void needs a reason.' });
		try {
			await voidExpense(hotel.id, parsed.data.id, parsed.data.reason, event.locals.user);
			return { ok: 'Expense voided.' };
		} catch (e) {
			if (e instanceof FinanceError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
