import { fail } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { amenityItems } from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import { FinanceError } from '$lib/server/finance/shared';
import {
	createStandaloneSale,
	findOrCreateAmenityItem,
	listStandaloneSalesForShift,
	getStandaloneSaleItems
} from '$lib/server/finance/standalone-sales';
import { getDefaultOpenShift, listShifts } from '$lib/server/finance/shifts';
import { getFinanceSettings } from '$lib/server/finance/settings';
import type { Actions, PageServerLoad } from './$types';

const METHODS = ['cash', 'card', 'gcash', 'maya', 'bank_transfer'] as const;

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'payment:create');
	const hotel = locals.hotel!;

	const [items, openShift, settings, shifts] = await Promise.all([
		db
			.select({ id: amenityItems.id, name: amenityItems.name, category: amenityItems.category, priceCentavos: amenityItems.priceCentavos })
			.from(amenityItems)
			.where(and(eq(amenityItems.hotelId, hotel.id), eq(amenityItems.isActive, true)))
			.orderBy(asc(amenityItems.sortOrder), asc(amenityItems.name)),
		getDefaultOpenShift(hotel.id),
		getFinanceSettings(hotel.id),
		listShifts(hotel.id, 30)
	]);

	// "Quick sales" browses one shift at a time — same convention
	// finance/shifts.ts's own reconciliation already uses (shiftId FK match) —
	// defaulting to the open one, but ?shiftId=<id> can view any past shift
	// read-only. A non-cash sale never carries a shiftId, so it never shows up
	// here regardless of which shift is being viewed.
	const requestedShiftId = url.searchParams.get('shiftId');
	const viewedShiftId =
		requestedShiftId && shifts.some((s) => s.id === requestedShiftId) ? requestedShiftId : (openShift?.id ?? null);
	const recentSales = viewedShiftId ? await listStandaloneSalesForShift(hotel.id, viewedShiftId, 50) : [];
	const recentWithItems = await Promise.all(
		recentSales.map(async (s) => ({ ...s, items: await getStandaloneSaleItems(s.id) }))
	);

	return {
		items,
		methods: METHODS,
		hasOpenShift: !!openShift,
		requireOpenShiftForCashPayment: settings.requireOpenShiftForCashPayment,
		shifts,
		viewedShiftId,
		openShiftId: openShift?.id ?? null,
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
	lines: z.array(lineSchema).min(1),
	tenderedCentavos: z.number().int().min(0).nullable().optional()
});
const customItemSchema = z.object({
	name: z.string().trim().min(1).max(160),
	priceCentavos: z.coerce.number().int().min(1)
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
			const { saleId, totalCentavos, changeCentavos } = await createStandaloneSale({
				hotelId: event.locals.hotel!.id,
				lines: parsed.lines,
				method: parsed.method,
				tenderedCentavos: parsed.tenderedCentavos,
				actor: event.locals.user
			});
			return { ok: 'Sale recorded.', saleId, totalCentavos, changeCentavos };
		} catch (e) {
			if (e instanceof FinanceError) return fail(400, { error: e.message });
			throw e;
		}
	},

	/** A "custom item" at the register becomes a real, reusable catalog entry —
	 *  see `findOrCreateAmenityItem`'s own doc comment for the match/create rule. */
	addCustomItem: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'payment:create');
		const fd = await event.request.formData();
		const parsed = customItemSchema.safeParse({ name: fd.get('name'), priceCentavos: fd.get('priceCentavos') });
		if (!parsed.success) return fail(400, { error: 'Enter a name and a positive price.' });

		try {
			const { item, matchedExisting } = await findOrCreateAmenityItem(
				event.locals.hotel!.id,
				parsed.data.name,
				parsed.data.priceCentavos
			);
			return { itemOk: true, item, matchedExisting };
		} catch (e) {
			if (e instanceof FinanceError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
