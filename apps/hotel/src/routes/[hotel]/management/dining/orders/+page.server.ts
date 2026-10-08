import { fail } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { diningItems, diningTables } from '$lib/server/db/schema/index';
import { roleCan } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import { recordId } from '$lib/rate-validation';
import { loadVenueMenu } from '$lib/server/dining-menu';
import {
	OrderError,
	cancelDiningOrder,
	createDiningOrder,
	listBoardOrders,
	payDiningOrder,
	setDiningOrderStatus,
	voidDiningOrderPayment
} from '$lib/server/dining-orders';
import { DocumentError, issueDiningDocument, listDiningDocumentsForOrders } from '$lib/server/finance/documents';
import { FinanceError } from '$lib/server/finance/shared';
import { getDefaultOpenShift } from '$lib/server/finance/shifts';
import { zonedToUtc, localParts } from '$lib/dining-slots';
import type { Actions, PageServerLoad } from './$types';

const PAYMENT_METHODS = ['cash', 'card', 'gcash', 'maya'] as const;

export const load: PageServerLoad = async ({ locals, url, depends }) => {
	depends('app:dining-orders');
	requireCap(locals.user, locals.role, 'dining:read');
	const hotelId = locals.hotel!.id;
	const timezone = locals.hotel!.timezone;

	const venues = await db
		.select({ id: diningItems.id, title: diningItems.title, isActive: diningItems.isActive })
		.from(diningItems)
		.where(eq(diningItems.hotelId, hotelId))
		.orderBy(asc(diningItems.sortOrder), asc(diningItems.title));

	const venueId = venues.find((v) => v.id === url.searchParams.get('venue'))?.id ?? null;

	// Served orders stay on the board for the rest of the business day, so a served-but-unpaid
	// table is still visible at the cashier.
	const today = localParts(new Date(), timezone).date;
	const servedSince = zonedToUtc(today, '00:00', timezone);
	const orders = await listBoardOrders(hotelId, { venueId, servedSince });
	const documents = await listDiningDocumentsForOrders(hotelId, orders.map((o) => o.id));

	// Everything the New order sheet needs, for every venue that has a menu.
	const menus: Record<string, Awaited<ReturnType<typeof loadVenueMenu>>> = {};
	for (const v of venues) {
		const m = await loadVenueMenu(hotelId, v.id);
		if (m.items.length > 0) menus[v.id] = m;
	}
	const tables = await db
		.select({ id: diningTables.id, venueId: diningTables.diningItemId, name: diningTables.name, seats: diningTables.seats })
		.from(diningTables)
		.where(eq(diningTables.hotelId, hotelId))
		.orderBy(asc(diningTables.name));

	const can = (cap: string) =>
		!!locals.user?.isPlatformAdmin || (!!locals.role && roleCan(locals.role.capabilities, cap));
	const shift = await getDefaultOpenShift(hotelId).catch(() => null);

	return {
		venues,
		venueId,
		orders: orders.map((o) => ({
			...o,
			createdAt: o.createdAt.toISOString(),
			acceptedAt: o.acceptedAt?.toISOString() ?? null,
			readyAt: o.readyAt?.toISOString() ?? null,
			servedAt: o.servedAt?.toISOString() ?? null,
			documents: documents[o.id] ?? []
		})),
		menus,
		tables: tables.filter((t) => menus[t.venueId]),
		vatRateBps: locals.hotel!.vatRateBps,
		shiftOpen: !!shift,
		canWrite: can('dining:write'),
		canVoid: can('dining:manage') || can('hotel:admin'),
		nowIso: new Date().toISOString()
	};
};

/** Anything the order, finance or BIR code refuses for a business reason (not a bug). */
const isBusinessError = (e: unknown) =>
	e instanceof OrderError || e instanceof FinanceError || e instanceof DocumentError;

const lineSchema = z.object({
	menuItemId: z.string().uuid(),
	quantity: z.number().int().min(1).max(50),
	remarks: z.string().max(300).optional(),
	addonIds: z.array(z.string().uuid()).max(30).optional()
});

const createSchema = z.object({
	venueId: z.string().uuid(),
	orderType: z.enum(['dine_in', 'takeaway']),
	tableId: z.string().uuid().nullish(),
	guestName: z.string().trim().max(120).optional(),
	remarks: z.string().trim().max(500).optional(),
	lines: z.array(lineSchema).min(1, 'Add at least one item.').max(40)
});

const toCentavos = (php: number) => Math.round(php * 100);

export const actions: Actions = {
	/** Places an order. `payNow` only tells the page to open the payment dialog next. */
	create: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dining:write');
		const raw = String((await event.request.formData()).get('payload') ?? '');
		let json: unknown;
		try {
			json = JSON.parse(raw);
		} catch {
			return fail(400, { error: 'That order could not be read. Please try again.' });
		}
		const parsed = createSchema.safeParse(json);
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the order and try again.' });
		const d = parsed.data;
		try {
			const r = await createDiningOrder({
				hotelId: event.locals.hotel!.id,
				venueId: d.venueId,
				orderType: d.orderType,
				tableId: d.tableId || null,
				guestName: d.guestName || null,
				remarks: d.remarks || null,
				lines: d.lines,
				source: 'staff',
				actor: event.locals.user
			});
			return { ok: `Order ${r.code} placed.`, placed: { id: r.id, code: r.code } };
		} catch (e) {
			if (isBusinessError(e)) return fail(400, { error: (e as Error).message });
			throw e;
		}
	},

	advance: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dining:write');
		const parsed = z
			.object({ orderId: recordId(), to: z.enum(['accepted', 'preparing', 'ready', 'served']) })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'That order could not be found.' });
		try {
			await setDiningOrderStatus({ hotelId: event.locals.hotel!.id, orderId: parsed.data.orderId, to: parsed.data.to, actor: event.locals.user });
			return { moved: true };
		} catch (e) {
			if (isBusinessError(e)) return fail(400, { error: (e as Error).message });
			throw e;
		}
	},

	cancel: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dining:write');
		const parsed = z
			.object({ orderId: recordId(), reason: z.string().trim().min(1, 'Give a reason for cancelling.').max(300) })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Give a reason for cancelling.' });
		try {
			await cancelDiningOrder({ hotelId: event.locals.hotel!.id, orderId: parsed.data.orderId, reason: parsed.data.reason, actor: event.locals.user });
			return { ok: 'Order cancelled.' };
		} catch (e) {
			if (isBusinessError(e)) return fail(400, { error: (e as Error).message });
			throw e;
		}
	},

	pay: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dining:write');
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = z
			.object({
				orderId: recordId(),
				method: z.enum(PAYMENT_METHODS),
				tenderedPhp: z.coerce.number().min(0).max(10_000_000).optional()
			})
			.safeParse({ ...raw, tenderedPhp: raw.tenderedPhp === '' ? undefined : raw.tenderedPhp });
		if (!parsed.success) return fail(400, { error: 'Choose how the guest is paying.' });
		const d = parsed.data;
		try {
			const r = await payDiningOrder({
				hotelId: event.locals.hotel!.id,
				orderId: d.orderId,
				method: d.method,
				tenderedCentavos: d.tenderedPhp != null ? toCentavos(d.tenderedPhp) : null,
				actor: event.locals.user
			});
			return { paid: { orderId: d.orderId, changeCentavos: r.changeCentavos, receiptId: r.receiptId } };
		} catch (e) {
			if (isBusinessError(e)) return fail(400, { error: (e as Error).message });
			throw e;
		}
	},

	voidPayment: async (event) => {
		const { user, role } = event.locals;
		if (!user?.isPlatformAdmin && !(role && (roleCan(role.capabilities, 'dining:manage') || roleCan(role.capabilities, 'hotel:admin')))) {
			requireCap(user, role, 'dining:manage');
		}
		const parsed = z
			.object({ orderId: recordId(), reason: z.string().trim().min(1, 'Give a reason for voiding the payment.').max(300) })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Give a reason.' });
		try {
			await voidDiningOrderPayment({ hotelId: event.locals.hotel!.id, orderId: parsed.data.orderId, reason: parsed.data.reason, actor: event.locals.user });
			return { ok: 'Payment voided. The receipt was cancelled.' };
		} catch (e) {
			if (isBusinessError(e)) return fail(400, { error: (e as Error).message });
			throw e;
		}
	},

	/** Issues the Official Receipt (when automatic issue didn't) or an Invoice with optional bill-to details. */
	issueDocument: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dining:write');
		const parsed = z
			.object({
				orderId: recordId(),
				type: z.enum(['official_receipt', 'invoice']),
				billToName: z.string().trim().max(160).optional(),
				billToAddress: z.string().trim().max(300).optional(),
				billToTin: z.string().trim().max(40).optional()
			})
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Check the details and try again.' });
		const d = parsed.data;
		try {
			const doc = await issueDiningDocument(event.locals.hotel!.id, d.orderId, d.type, event.locals.user, {
				billTo: { name: d.billToName, address: d.billToAddress, tin: d.billToTin }
			});
			return { issued: { id: doc.id, type: d.type, formattedNo: doc.formattedNo } };
		} catch (e) {
			if (isBusinessError(e)) return fail(400, { error: (e as Error).message });
			throw e;
		}
	}
};
