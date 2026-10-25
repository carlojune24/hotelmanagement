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
import { diningDrawerId } from '$lib/server/finance/payments';
import { chargeDiningLinesToRoom, listInHouseGuests } from '$lib/server/dining-room-charge';
import { OrderError } from '$lib/server/dining-orders';
import { getDefaultOpenShift, getOpenShiftForDrawer, listShifts } from '$lib/server/finance/shifts';
import { getFinanceSettings } from '$lib/server/finance/settings';
import { listCashAccounts } from '$lib/server/finance/accounts';
import type { Actions, PageServerLoad } from './$types';

const METHODS = ['cash', 'card', 'gcash', 'maya', 'bank_transfer'] as const;

/**
 * The restaurant's off-menu till: corkage, a bottle of water, anything with no dish behind it.
 * The same sale the front desk's Quick sale records, with two differences that matter — the cash
 * goes into **dining's** drawer, and it posts as `dining_revenue` so it shows up in Dining's own
 * Sales and Cashflow rather than disappearing into the hotel's incidentals.
 *
 * A dish goes through Orders → New order instead; that is what the kitchen board is for.
 */
async function diningTill(hotelId: string) {
	const drawerId = await diningDrawerId(hotelId);
	const openShift = await (
		drawerId ? getOpenShiftForDrawer(hotelId, drawerId) : getDefaultOpenShift(hotelId)
	).catch(() => null);
	return { drawerId, openShift };
}

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'dining:write');
	const hotel = locals.hotel!;

	const { drawerId, openShift } = await diningTill(hotel.id);
	const [items, settings, shifts, accounts, inHouse] = await Promise.all([
		db
			.select({ id: amenityItems.id, name: amenityItems.name, category: amenityItems.category, priceCentavos: amenityItems.priceCentavos })
			.from(amenityItems)
			.where(and(eq(amenityItems.hotelId, hotel.id), eq(amenityItems.isActive, true)))
			.orderBy(asc(amenityItems.sortOrder), asc(amenityItems.name)),
		getFinanceSettings(hotel.id),
		listShifts(hotel.id, 30, drawerId),
		listCashAccounts(hotel.id),
		// For "Room": the same picker the dining pay dialog uses.
		listInHouseGuests(hotel.id)
	]);

	// One shift at a time, dining's own, defaulting to the open one — the same convention the
	// front desk's Quick sale and the shift reconciliation already use.
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
		drawerName: drawerId ? (accounts.find((a) => a.id === drawerId)?.name ?? 'Dining drawer') : null,
		inHouse,
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
/** Room charges carry their own lines: a folio shows names and prices, not catalog ids. */
const roomChargeSchema = z.object({
	lines: z
		.array(
			z.object({
				amenityItemId: z.string().uuid().nullable().optional(),
				description: z.string().trim().min(1).max(160),
				quantity: z.number().int().min(1).max(999),
				unitPriceCentavos: z.number().int().min(1)
			})
		)
		.min(1)
});
const customItemSchema = z.object({
	name: z.string().trim().min(1).max(160),
	priceCentavos: z.coerce.number().int().min(1)
});

export const actions: Actions = {
	sell: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dining:write');
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
				// Dining's own till and its own revenue line.
				drawerAccountId: await diningDrawerId(event.locals.hotel!.id),
				category: 'dining_revenue',
				actor: event.locals.user
			});
			return { ok: 'Sale recorded.', saleId, totalCentavos, changeCentavos };
		} catch (e) {
			if (e instanceof FinanceError) return fail(400, { error: e.message });
			throw e;
		}
	},

	/**
	 * "Room": the cart goes on a staying guest's bill instead of through the till. No cash
	 * movement and no shift — the front desk collects it at checkout, and the dining share comes
	 * back to `dining_revenue` when the folio is settled. Recording a sale here as well would
	 * count the same money twice.
	 */
	chargeRoom: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dining:write');
		const fd = await event.request.formData();
		const raw = fd.get('cart');
		const bookingId = fd.get('bookingId');
		if (typeof raw !== 'string') return fail(400, { error: 'Empty cart.' });
		if (typeof bookingId !== 'string' || !bookingId) return fail(400, { error: 'Choose the guest to charge.' });

		let parsed;
		try {
			parsed = roomChargeSchema.parse(JSON.parse(raw));
		} catch {
			return fail(400, { error: 'Could not read the cart — try again.' });
		}

		try {
			const charged = await chargeDiningLinesToRoom({
				hotelId: event.locals.hotel!.id,
				bookingId,
				lines: parsed.lines,
				memo: 'Quick sale',
				actor: event.locals.user
			});
			return { ok: `Charged ${charged.guestName}, room ${charged.roomLabel}.`, charged };
		} catch (e) {
			if (e instanceof OrderError || e instanceof FinanceError) return fail(400, { error: e.message });
			throw e;
		}
	},

	/** A custom item typed at the till becomes a reusable catalog entry — see
	 *  `findOrCreateAmenityItem` for the match/create rule. */
	addCustomItem: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dining:write');
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
