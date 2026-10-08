import { fail } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { diningItems, diningOrders, diningTables } from '$lib/server/db/schema/index';
import { roleCan } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import { recordId } from '$lib/rate-validation';
import { loadVenueMenu } from '$lib/server/dining-menu';
import {
	OrderError,
	cancelDiningOrder,
	countAwaitingPayment,
	createDiningOrder,
	listBoardOrders,
	listRefundDueOrders,
	payDiningOrder,
	setDiningOrderStatus,
	voidDiningOrderPayment
} from '$lib/server/dining-orders';
import {
	REFUND_METHODS,
	expirePendingDiningOrders,
	listOrderMessages,
	markGuestMessagesRead,
	postStaffMessage,
	recordDiningRefund,
	respondToDiningCancellation
} from '$lib/server/dining-online';
import { UploadValidationError, deleteUploadIfOwned, saveUpload } from '$lib/server/uploads';
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
	// Release online orders whose payment never arrived before showing the board.
	await expirePendingDiningOrders({ hotelId }).catch((e) => console.error('orders: expirePendingDiningOrders failed', e));
	const orders = await listBoardOrders(hotelId, { venueId, servedSince });
	const refundDue = await listRefundDueOrders(hotelId, venueId);
	const awaitingPayment = await countAwaitingPayment(hotelId, venueId);
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

	const serialize = <T extends (typeof orders)[number]>(o: T) => ({
		...o,
		createdAt: o.createdAt.toISOString(),
		acceptedAt: o.acceptedAt?.toISOString() ?? null,
		readyAt: o.readyAt?.toISOString() ?? null,
		servedAt: o.servedAt?.toISOString() ?? null,
		pickupAt: o.pickupAt?.toISOString() ?? null,
		cancelRequestedAt: o.cancelRequestedAt?.toISOString() ?? null
	});

	return {
		venues,
		venueId,
		orders: orders.map((o) => ({ ...serialize(o), documents: documents[o.id] ?? [] })),
		/** Cancelled orders the guest had paid for: money still owed back. */
		refundDue: refundDue.map((o) => serialize(o)),
		awaitingPayment,
		timezone,
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

	/** Opens a guest conversation: returns its messages and marks the guest's as read. */
	openThread: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dining:read');
		const parsed = z.object({ orderId: recordId() }).safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'That order could not be found.' });
		const hotelId = event.locals.hotel!.id;
		const [o] = await db.select({ id: diningOrders.id }).from(diningOrders).where(and(eq(diningOrders.id, parsed.data.orderId), eq(diningOrders.hotelId, hotelId))).limit(1);
		if (!o) return fail(404, { error: 'That order could not be found.' });
		await markGuestMessagesRead(hotelId, o.id);
		const messages = await listOrderMessages(hotelId, o.id);
		return { thread: { orderId: o.id, messages: messages.map((m) => ({ id: m.id, direction: m.direction, body: m.body, createdAt: m.createdAt.toISOString() })) } };
	},

	reply: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dining:write');
		const parsed = z
			.object({ orderId: recordId(), body: z.string().trim().min(1, 'Type a message first.').max(1000, 'Please keep messages under 1,000 characters.') })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Type a message first.' });
		try {
			await postStaffMessage({ hotelId: event.locals.hotel!.id, orderId: parsed.data.orderId, body: parsed.data.body, actor: event.locals.user });
			return { replied: true };
		} catch (e) {
			if (isBusinessError(e)) return fail(400, { error: (e as Error).message });
			throw e;
		}
	},

	/** Approve or decline a guest's request to cancel an order they already paid for. */
	respondCancel: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dining:write');
		const parsed = z
			.object({ orderId: recordId(), approve: z.enum(['true', 'false']), message: z.string().trim().max(500).optional() })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Choose to approve or decline.' });
		try {
			await respondToDiningCancellation({
				hotelId: event.locals.hotel!.id,
				orderId: parsed.data.orderId,
				approve: parsed.data.approve === 'true',
				message: parsed.data.message,
				actor: event.locals.user
			});
			return { ok: parsed.data.approve === 'true' ? 'Order cancelled. Record the refund when you have sent it.' : 'Request declined. The guest was told.' };
		} catch (e) {
			if (isBusinessError(e)) return fail(400, { error: (e as Error).message });
			throw e;
		}
	},

	/** Records a refund already sent to the guest (manager action), with its reference and an optional proof photo. */
	recordRefund: async (event) => {
		const { user, role } = event.locals;
		if (!user?.isPlatformAdmin && !(role && (roleCan(role.capabilities, 'dining:manage') || roleCan(role.capabilities, 'hotel:admin')))) {
			requireCap(user, role, 'dining:manage');
		}
		const form = await event.request.formData();
		const parsed = z
			.object({
				orderId: recordId(),
				amountPhp: z.coerce.number().positive('Enter the refund amount.').max(10_000_000),
				method: z.enum(REFUND_METHODS, { error: 'Choose how the refund was sent.' }),
				referenceNo: z.string().trim().max(80).optional(),
				note: z.string().trim().max(300).optional()
			})
			.safeParse(Object.fromEntries(form));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the refund details.' });
		const d = parsed.data;
		const hotelId = event.locals.hotel!.id;

		let proofUrl: string | null = null;
		const file = form.get('proof');
		if (file instanceof File && file.size > 0) {
			try {
				proofUrl = await saveUpload(hotelId, file);
			} catch (e) {
				if (e instanceof UploadValidationError) return fail(400, { error: e.message });
				throw e;
			}
		}
		try {
			const r = await recordDiningRefund({
				hotelId,
				orderId: d.orderId,
				amountCentavos: Math.round(d.amountPhp * 100),
				method: d.method,
				referenceNo: d.referenceNo || null,
				note: d.note || null,
				proofUrl,
				actor: user
			});
			return { ok: r.fullyRefunded ? 'Refund recorded. The order is fully refunded.' : 'Partial refund recorded.' };
		} catch (e) {
			// Don't keep an uploaded proof for a refund that was refused.
			if (proofUrl) await deleteUploadIfOwned(proofUrl).catch(() => {});
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
