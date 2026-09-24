import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { hotels } from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { FinanceError } from '$lib/server/finance/shared';
import {
	createCashAccount,
	createExpenseCategory,
	createVendor,
	deleteCashAccount,
	deleteExpenseCategory,
	deleteVendor,
	listCashAccounts,
	listExpenseCategories,
	listVendors,
	updateCashAccount,
	updateExpenseCategory,
	updateVendor
} from '$lib/server/finance/accounts';
import { ensureFinanceSettings, getFinanceSettings, updateFinanceSettings } from '$lib/server/finance/settings';
import { createApiKey, listApiKeysForHotel, revokeApiKey } from '$lib/server/auth/api-key';
import { getScPwdDiscountBps, setScPwdDiscountBps } from '$lib/server/sc-pwd-discount';
import type { Actions, PageServerLoad } from './$types';

const ACCOUNT_KINDS = ['cash_drawer', 'petty_cash', 'bank', 'e_wallet', 'undeposited'] as const;
const EXPENSE_GROUPS = [
	'cogs',
	'utilities',
	'payroll',
	'supplies',
	'repairs',
	'marketing',
	'commissions',
	'taxes_licenses',
	'rent',
	'admin',
	'other'
] as const;

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'hotel:admin');
	const hotel = locals.hotel!;
	await ensureFinanceSettings(hotel.id);
	const [accounts, categories, vendors, settings, apiKeys, hotelDetails, scPwdDiscountBps] =
		await Promise.all([
			listCashAccounts(hotel.id, { includeInactive: true }),
			listExpenseCategories(hotel.id, { includeInactive: true }),
			listVendors(hotel.id, { includeInactive: true }),
			getFinanceSettings(hotel.id),
			listApiKeysForHotel(hotel.id),
			db
				.select({ currency: hotels.currency, vatRateBps: hotels.vatRateBps, timezone: hotels.timezone })
				.from(hotels)
				.where(eq(hotels.id, hotel.id))
				.then((r) => r[0]!),
			getScPwdDiscountBps(hotel.id)
		]);
	return {
		accounts,
		categories,
		vendors,
		settings,
		apiKeys,
		hotelDetails,
		scPwdDiscountBps,
		accountKinds: ACCOUNT_KINDS,
		expenseGroups: EXPENSE_GROUPS
	};
};

const wrap = async (fn: () => Promise<unknown>, ok: string) => {
	try {
		await fn();
		return { ok };
	} catch (e) {
		if (e instanceof FinanceError) return fail(400, { error: e.message });
		throw e;
	}
};

export const actions: Actions = {
	updateHotelDetails: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;
		const p = z
			.object({
				currency: z.enum(['PHP']),
				vatRatePct: z.coerce.number().min(0).max(30),
				timezone: z.string().min(1).max(64),
				scPwdDiscountPct: z.coerce.number().min(0).max(100).default(20)
			})
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!p.success) return fail(400, { error: 'Check the hotel details.' });

		await db
			.update(hotels)
			.set({
				currency: p.data.currency,
				vatRateBps: Math.round(p.data.vatRatePct * 100),
				timezone: p.data.timezone,
				updatedAt: new Date()
			})
			.where(eq(hotels.id, hotelId));
		await setScPwdDiscountBps(
			hotelId,
			Math.round(p.data.scPwdDiscountPct * 100),
			event.locals.user
		);
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'hotel.update_details',
			entityType: 'hotel',
			entityId: hotelId,
			after: p.data
		});
		return { ok: 'Hotel details saved.' };
	},

	createAccount: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const p = z
			.object({
				name: z.string().min(1).max(120),
				kind: z.enum(ACCOUNT_KINDS),
				institution: z.string().max(120).optional(),
				accountRef: z.string().max(120).optional(),
				openingBalance: z.coerce.number().optional()
			})
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!p.success) return fail(400, { error: 'Check the account fields.' });
		return wrap(
			() =>
				createCashAccount(
					event.locals.hotel!.id,
					{
						name: p.data.name,
						kind: p.data.kind,
						institution: p.data.institution || null,
						accountRef: p.data.accountRef || null,
						openingBalanceCentavos: Math.round((p.data.openingBalance ?? 0) * 100)
					},
					event.locals.user
				),
			'Account added.'
		);
	},

	updateAccount: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const p = z
			.object({
				id: z.string().uuid(),
				name: z.string().min(1).max(120).optional(),
				institution: z.string().max(120).optional(),
				accountRef: z.string().max(120).optional(),
				isActive: z.enum(['true', 'false']).optional()
			})
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!p.success) return fail(400, { error: 'Check the fields.' });
		return wrap(
			() =>
				updateCashAccount(
					event.locals.hotel!.id,
					p.data.id,
					{
						name: p.data.name,
						institution: p.data.institution,
						accountRef: p.data.accountRef,
						isActive: p.data.isActive === undefined ? undefined : p.data.isActive === 'true'
					},
					event.locals.user
				),
			'Account updated.'
		);
	},

	deleteAccount: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const id = (await event.request.formData()).get('id');
		if (typeof id !== 'string') return fail(400, { error: 'Missing account.' });
		return wrap(() => deleteCashAccount(event.locals.hotel!.id, id, event.locals.user), 'Account removed.');
	},

	createCategory: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const p = z
			.object({ name: z.string().min(1).max(120), group: z.enum(EXPENSE_GROUPS) })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!p.success) return fail(400, { error: 'Check the category.' });
		return wrap(
			() => createExpenseCategory(event.locals.hotel!.id, { name: p.data.name, group: p.data.group }, event.locals.user),
			'Category added.'
		);
	},

	updateCategory: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const p = z
			.object({
				id: z.string().uuid(),
				name: z.string().min(1).max(120).optional(),
				group: z.enum(EXPENSE_GROUPS).optional(),
				isActive: z.enum(['true', 'false']).optional()
			})
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!p.success) return fail(400, { error: 'Check the fields.' });
		return wrap(
			() =>
				updateExpenseCategory(
					event.locals.hotel!.id,
					p.data.id,
					{
						name: p.data.name,
						group: p.data.group,
						isActive: p.data.isActive === undefined ? undefined : p.data.isActive === 'true'
					},
					event.locals.user
				),
			'Category updated.'
		);
	},

	deleteCategory: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const id = (await event.request.formData()).get('id');
		if (typeof id !== 'string') return fail(400, { error: 'Missing category.' });
		return wrap(() => deleteExpenseCategory(event.locals.hotel!.id, id, event.locals.user), 'Category removed.');
	},

	createVendor: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const p = z
			.object({
				name: z.string().min(1).max(160),
				tin: z.string().max(40).optional(),
				address: z.string().max(300).optional(),
				contactName: z.string().max(120).optional(),
				contactPhone: z.string().max(40).optional(),
				contactEmail: z.string().max(160).optional()
			})
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!p.success) return fail(400, { error: 'Check the vendor.' });
		return wrap(() => createVendor(event.locals.hotel!.id, p.data, event.locals.user), 'Vendor added.');
	},

	updateVendor: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const fd = Object.fromEntries(await event.request.formData());
		const p = z
			.object({
				id: z.string().uuid(),
				name: z.string().min(1).max(160).optional(),
				tin: z.string().max(40).optional(),
				address: z.string().max(300).optional(),
				contactName: z.string().max(120).optional(),
				contactPhone: z.string().max(40).optional(),
				contactEmail: z.string().max(160).optional(),
				isActive: z.enum(['true', 'false']).optional()
			})
			.safeParse(fd);
		if (!p.success) return fail(400, { error: 'Check the fields.' });
		const { id, isActive, ...rest } = p.data;
		return wrap(
			() =>
				updateVendor(
					event.locals.hotel!.id,
					id,
					{ ...rest, isActive: isActive === undefined ? undefined : isActive === 'true' },
					event.locals.user
				),
			'Vendor updated.'
		);
	},

	deleteVendor: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const id = (await event.request.formData()).get('id');
		if (typeof id !== 'string') return fail(400, { error: 'Missing vendor.' });
		return wrap(() => deleteVendor(event.locals.hotel!.id, id, event.locals.user), 'Vendor removed.');
	},

	updateSettings: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const fd = Object.fromEntries(await event.request.formData());
		const p = z
			.object({
				defaultDrawerAccountId: z.string().uuid().optional().or(z.literal('')),
				defaultBankAccountId: z.string().uuid().optional().or(z.literal('')),
				undepositedAccountId: z.string().uuid().optional().or(z.literal('')),
				autoPostOnlinePayments: z.enum(['on']).optional(),
				requireExpenseApproval: z.enum(['on']).optional(),
				lockOnDayClose: z.enum(['on']).optional(),
				requireOpenShiftForCashPayment: z.enum(['on']).optional(),
				dayCloseCutoffTime: z
					.string()
					.regex(/^([01]\d|2[0-3]):[0-5]\d$/)
					.optional()
					.or(z.literal('')),
				staleShiftHours: z.coerce.number().int().min(1).max(72)
			})
			.safeParse(fd);
		if (!p.success) return fail(400, { error: 'Check the settings.' });
		return wrap(
			() =>
				updateFinanceSettings(
					event.locals.hotel!.id,
					{
						defaultDrawerAccountId: p.data.defaultDrawerAccountId || null,
						defaultBankAccountId: p.data.defaultBankAccountId || null,
						undepositedAccountId: p.data.undepositedAccountId || null,
						autoPostOnlinePayments: p.data.autoPostOnlinePayments === 'on',
						requireExpenseApproval: p.data.requireExpenseApproval === 'on',
						lockOnDayClose: p.data.lockOnDayClose === 'on',
						requireOpenShiftForCashPayment: p.data.requireOpenShiftForCashPayment === 'on',
						dayCloseCutoffTime: p.data.dayCloseCutoffTime || null,
						staleShiftHours: p.data.staleShiftHours
					},
					event.locals.user
				),
			'Finance settings saved.'
		);
	},

	createApiKey: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const p = z
			.object({ name: z.string().min(1).max(120) })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!p.success) return fail(400, { error: 'Give the key a name.' });
		try {
			const { rawKey } = await createApiKey({
				name: p.data.name,
				hotelIds: [event.locals.hotel!.id],
				createdByUserId: event.locals.user?.id ?? null
			});
			// Shown once — never retrievable again after this response.
			return { ok: 'API key created — copy it now, it will not be shown again.', rawKey };
		} catch (e) {
			if (e instanceof Error) return fail(400, { error: e.message });
			throw e;
		}
	},

	revokeApiKeyAction: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const id = (await event.request.formData()).get('id');
		if (typeof id !== 'string') return fail(400, { error: 'Missing key.' });
		await revokeApiKey(id);
		return { ok: 'API key revoked.' };
	}
};
