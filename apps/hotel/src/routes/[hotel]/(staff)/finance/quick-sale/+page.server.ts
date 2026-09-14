import { fail } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { amenityItems } from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import { FinanceError } from '$lib/server/finance/shared';
import { createStandaloneSale, listStandaloneSales, getStandaloneSaleItems } from '$lib/server/finance/standalone-sales';
import { getDefaultOpenShift } from '$lib/server/finance/shifts';
import { getFinanceSettings } from '$lib/server/finance/settings';
import type { Actions, PageServerLoad } from './$types';

const METHODS = ['cash', 'card', 'gcash', 'maya', 'bank_transfer'] as const;

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'payment:create');
	const hotel = locals.hotel!;

	const [items, openShift, settings, recentSales] = await Promise.all([
		db
			.select({ id: amenityItems.id, name: amenityItems.name, category: amenityItems.category, priceCentavos: amenityItems.priceCentavos })
			.from(amenityItems)
			.where(and(eq(amenityItems.hotelId, hotel.id), eq(amenityItems.isActive, true)))
			.orderBy(asc(amenityItems.sortOrder), asc(amenityItems.name)),
		getDefaultOpenShift(hotel.id),
		getFinanceSettings(hotel.id),
		listStandaloneSales(hotel.id, 20)
	]);

	const recentWithItems = await Promise.all(
		recentSales.map(async (s) => ({ ...s, items: await getStandaloneSaleItems(s.id) }))
	);

	return {
		items,
		methods: METHODS,
		hasOpenShift: !!openShift,
		requireOpenShiftForCashPayment: settings.requireOpenShiftForCashPayment,
		recentSales: recentWithItems
	};
};

const lineSchema = z.object({
	amenityItemId: z.string().uuid().nullable().optional(),
	description: z.string().max(160).optional(),
	quantity: z.number().int().min(1).max(999),
	unitPriceCentavos: z.number().int().min(1).optional()
});
const saleSchema = z.object({
	method: z.enum(METHODS),
	lines: z.array(lineSchema).min(1)
});

export const actions: Actions = {
	sell: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'payment:create');
		const fd = await event.request.formData();
		const raw = fd.get('cart');
		if (typeof raw !== 'string') return fail(400, { error: 'Empty cart.' });

		let parsed;
		try {
			parsed = saleSchema.parse({ ...JSON.parse(raw) });
		} catch {
			return fail(400, { error: 'Could not read the cart — try again.' });
		}

		try {
			const { saleId } = await createStandaloneSale({
				hotelId: event.locals.hotel!.id,
				lines: parsed.lines,
				method: parsed.method,
				actor: event.locals.user
			});
			return { ok: 'Sale recorded.', saleId };
		} catch (e) {
			if (e instanceof FinanceError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
