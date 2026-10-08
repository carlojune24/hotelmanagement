import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { db } from './db/index';
import {
	diningItems,
	diningOrderItemAddons,
	diningOrderItems,
	diningOrderMessages,
	diningOrders,
	diningPayments,
	diningReservations,
	documents,
	financeSettings,
	hotels
} from './db/schema/index';
import { writeAudit } from './audit';
import type { SessionUser } from './auth/session';
import { FinanceError, businessDateFor } from './finance/shared';
import { recordCashMovement } from './finance/cash';
import { resolvePaymentAccount } from './finance/payments';
import { getBirSettings, issueDiningDocument } from './finance/documents';
import { getPaymongoClient, isOnlinePaymentEnabled } from './paymongo/client';
import { createDiningOrder, OrderError, type OrderLineInput } from './dining-orders';
import { sendDiningOrderEmail } from './email/send-dining-order';
import { listSlots, localParts } from '../dining-slots';

type Actor = SessionUser | null;

/** Unpaid online orders are released after this long, like unpaid room holds. */
export const PENDING_PAYMENT_MINUTES = 30;

const METHOD_LABEL: Record<string, string> = {
	cash: 'cash',
	gcash: 'GCash',
	maya: 'Maya',
	card: 'card',
	bank_transfer: 'bank transfer',
	paymongo_dashboard: 'the PayMongo dashboard',
	other: 'another method'
};
export const REFUND_METHODS = ['cash', 'gcash', 'maya', 'card', 'bank_transfer', 'paymongo_dashboard', 'other'] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];

const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ---------------------------------------------------------------------------
// Settings and pickup times
// ---------------------------------------------------------------------------

export interface OnlineOrderingConfig {
	venueId: string;
	title: string;
	/** Guests can order from this venue right now (switched on, hours set, a way to pay). */
	enabled: boolean;
	orderOpen: string | null;
	orderClose: string | null;
	prepMinutes: number;
	canPayOnline: boolean;
	canPayAtVenue: boolean;
}

export async function loadOnlineOrderingConfig(hotelId: string, venueId: string): Promise<OnlineOrderingConfig | null> {
	const [v] = await db
		.select()
		.from(diningItems)
		.where(and(eq(diningItems.id, venueId), eq(diningItems.hotelId, hotelId)))
		.limit(1);
	if (!v) return null;
	const canPayOnline = await isOnlinePaymentEnabled(hotelId);
	const canPayAtVenue = v.onlinePayment === 'online_or_venue';
	return {
		venueId: v.id,
		title: v.title,
		enabled: v.onlineOrdersEnabled && v.isActive && !!v.orderOpen && !!v.orderClose && (canPayOnline || canPayAtVenue),
		orderOpen: v.orderOpen,
		orderClose: v.orderClose,
		prepMinutes: v.prepMinutes,
		canPayOnline,
		canPayAtVenue
	};
}

/** Pickup times a guest can choose on `date`: every 15 minutes inside the ordering hours, at least
 *  the prep time from now, within the next week. */
export function pickupSlots(cfg: Pick<OnlineOrderingConfig, 'orderOpen' | 'orderClose' | 'prepMinutes'>, date: string, tz: string, now: Date) {
	if (!cfg.orderOpen || !cfg.orderClose) return [];
	return listSlots(
		{ seatingOpen: cfg.orderOpen, lastSeating: cfg.orderClose, slotMinutes: 15, turnMinutes: 15, minNoticeMinutes: cfg.prepMinutes, advanceDays: 7, maxPartySize: 1 },
		date,
		tz,
		now
	);
}

// ---------------------------------------------------------------------------
// Placing an online order
// ---------------------------------------------------------------------------

export interface PlaceOnlineOrderInput {
	hotelId: string;
	venueId: string;
	timezone: string;
	orderType: 'takeaway' | 'pre_order';
	/** Takeaway: the pickup date (`YYYY-MM-DD`) and time (`HH:MM`) in the hotel's timezone. */
	date?: string;
	time?: string;
	/** Pre-order: the guest's own table reservation (code + the token from their ticket). */
	reservation?: { code: string; token: string };
	guestName: string;
	guestPhone: string;
	guestEmail?: string | null;
	remarks?: string | null;
	payMode: 'online' | 'venue';
	lines: OrderLineInput[];
	now?: Date;
}

/**
 * Places a guest's online order. Takeaway needs a valid pickup time; a pre-order attaches to the
 * guest's own reservation (proved by its ticket token) and is served at their table time. Paying
 * online starts the order as `pending_payment`, invisible to the kitchen until PayMongo confirms;
 * paying at the restaurant is only allowed where the venue permits it and goes straight to the kitchen.
 */
export async function placeOnlineOrder(
	input: PlaceOnlineOrderInput
): Promise<{ id: string; code: string; accessToken: string; status: 'pending_payment' | 'new'; totalCentavos: number }> {
	const cfg = await loadOnlineOrderingConfig(input.hotelId, input.venueId);
	if (!cfg || !cfg.enabled) throw new OrderError('Online ordering is not available for this venue right now.');
	if (input.payMode === 'online' && !cfg.canPayOnline) throw new OrderError('Online payment is not available. Please choose to pay at the restaurant.');
	if (input.payMode === 'venue' && !cfg.canPayAtVenue) throw new OrderError('This venue takes online orders with online payment only.');

	const name = input.guestName.trim();
	const phone = input.guestPhone.trim();
	if (!name) throw new OrderError('Please enter your name.');
	if (phone.length < 5) throw new OrderError('Please enter a mobile number we can reach.');
	const now = input.now ?? new Date();

	let pickupAt: Date;
	let reservationId: string | null = null;
	if (input.orderType === 'takeaway') {
		if (!input.date || !input.time) throw new OrderError('Choose a pickup time.');
		const slot = pickupSlots(cfg, input.date, input.timezone, now).find((s) => s.time === input.time);
		if (!slot) throw new OrderError('That pickup time is no longer available. Please choose another.');
		pickupAt = slot.startsAt;
	} else {
		if (!input.reservation) throw new OrderError('Open your reservation ticket to pre-order for your table.');
		const [r] = await db
			.select()
			.from(diningReservations)
			.where(
				and(
					eq(diningReservations.hotelId, input.hotelId),
					eq(diningReservations.code, input.reservation.code.toUpperCase()),
					eq(diningReservations.accessToken, /^[0-9a-f-]{36}$/i.test(input.reservation.token) ? input.reservation.token : '00000000-0000-0000-0000-000000000000')
				)
			)
			.limit(1);
		if (!r || r.diningItemId !== input.venueId) throw new OrderError('We could not find that reservation.');
		if (r.status !== 'pending' && r.status !== 'confirmed') throw new OrderError('This reservation is no longer active.');
		if (r.startsAt.getTime() <= now.getTime() + cfg.prepMinutes * 60_000) {
			throw new OrderError(`Pre-orders need at least ${cfg.prepMinutes} minutes before your table time.`);
		}
		pickupAt = r.startsAt;
		reservationId = r.id;
	}

	// A light brake on someone filling the kitchen with unpaid orders from one phone number.
	const [{ n } = { n: 0 }] = await db
		.select({ n: sql<number>`count(*)` })
		.from(diningOrders)
		.where(
			and(
				eq(diningOrders.hotelId, input.hotelId),
				eq(diningOrders.source, 'online'),
				eq(diningOrders.guestPhone, phone),
				eq(diningOrders.paymentStatus, 'unpaid'),
				inArray(diningOrders.status, ['pending_payment', 'new', 'accepted', 'preparing'])
			)
		);
	if (Number(n) >= 3) throw new OrderError('You already have several open orders. Please wait for them to be ready or contact us.');

	const status = input.payMode === 'online' ? 'pending_payment' : 'new';
	const created = await createDiningOrder({
		hotelId: input.hotelId,
		venueId: input.venueId,
		orderType: input.orderType,
		lines: input.lines,
		reservationId,
		guestName: name,
		guestPhone: phone,
		guestEmail: input.guestEmail?.trim() || null,
		remarks: input.remarks?.trim() || null,
		source: 'online',
		pickupAt,
		payMode: input.payMode,
		initialStatus: status
	});

	// Paying at the restaurant: the order is already in the kitchen, so confirm it now.
	if (status === 'new' && input.guestEmail) void sendDiningOrderEmail(created.id, 'confirmation');
	return { ...created, status };
}

// ---------------------------------------------------------------------------
// PayMongo checkout and payment confirmation
// ---------------------------------------------------------------------------

/**
 * Starts (or restarts) the hosted PayMongo checkout for an order awaiting online payment. The
 * session's lines are the order's own snapshotted dishes, so the guest is charged exactly the
 * total they saw (VAT is already inside the prices). Any earlier unpaid session is expired first.
 */
export async function startDiningCheckout(args: {
	hotelId: string;
	orderId: string;
	hotelName: string;
	successUrl: string;
	cancelUrl: string;
}): Promise<{ checkoutUrl: string }> {
	const [order] = await db
		.select()
		.from(diningOrders)
		.where(and(eq(diningOrders.id, args.orderId), eq(diningOrders.hotelId, args.hotelId)))
		.limit(1);
	if (!order) throw new OrderError('That order could not be found.');
	if (order.status !== 'pending_payment' || order.payMode !== 'online') throw new OrderError('This order is not waiting for online payment.');

	const items = await db.select().from(diningOrderItems).where(eq(diningOrderItems.orderId, order.id)).orderBy(asc(diningOrderItems.sortOrder));
	const addons = items.length
		? await db.select().from(diningOrderItemAddons).where(inArray(diningOrderItemAddons.orderItemId, items.map((i) => i.id)))
		: [];

	const client = await getPaymongoClient(args.hotelId);

	// Expire any earlier unpaid session so only the newest link can be paid.
	const pending = await db
		.select()
		.from(diningPayments)
		.where(and(eq(diningPayments.orderId, order.id), eq(diningPayments.kind, 'payment'), eq(diningPayments.status, 'pending')));
	for (const p of pending) {
		if (p.paymongoCheckoutSessionId) await client.expireCheckoutSession(p.paymongoCheckoutSessionId).catch(() => {});
		await db.update(diningPayments).set({ status: 'expired' }).where(eq(diningPayments.id, p.id));
	}

	const lineItems = items.map((i) => {
		const extras = addons.filter((a) => a.orderItemId === i.id).map((a) => a.name);
		return {
			currency: 'PHP',
			amount: i.lineTotalCentavos,
			name: `${i.quantity}× ${i.name}`.slice(0, 100),
			description: (extras.length ? extras.join(', ') : 'VAT included').slice(0, 200),
			quantity: 1
		};
	});
	const sum = lineItems.reduce((s, l) => s + l.amount, 0);
	if (sum !== order.totalCentavos) throw new OrderError('This order could not be priced for payment. Please contact the restaurant.');

	const session = await client.createCheckoutSession({
		billing: { name: order.guestName ?? 'Guest', email: order.guestEmail ?? undefined, phone: order.guestPhone ?? undefined },
		send_email_receipt: false,
		show_description: true,
		show_line_items: true,
		line_items: lineItems,
		payment_method_types: ['gcash', 'card', 'paymaya', 'qrph'],
		description: `${args.hotelName}: order ${order.code}`,
		success_url: args.successUrl,
		cancel_url: args.cancelUrl,
		metadata: { kind: 'dining', diningOrderId: order.id }
	});

	await db.insert(diningPayments).values({
		hotelId: args.hotelId,
		orderId: order.id,
		kind: 'payment',
		status: 'pending',
		provider: 'paymongo',
		amountCentavos: order.totalCentavos,
		paymongoCheckoutSessionId: session.id
	});
	return { checkoutUrl: session.attributes.checkout_url };
}

/** The hotel a dining checkout event belongs to (for the webhook's per-hotel scoping), or null. */
export async function diningEventHotelId(diningOrderId: string): Promise<string | null> {
	const [o] = await db.select({ hotelId: diningOrders.hotelId }).from(diningOrders).where(eq(diningOrders.id, diningOrderId)).limit(1);
	return o?.hotelId ?? null;
}

/**
 * Records a confirmed PayMongo payment for a dining order (called by the webhook). Idempotent per
 * event. A payment on an order still awaiting payment releases it to the kitchen and is posted to
 * the cash ledger as `dining_revenue`. A payment that lands on an order that was already cancelled
 * or already paid is still recorded (money is never dropped) and flagged for a refund.
 */
export async function confirmDiningPayment(args: {
	eventId: string;
	orderId: string;
	sessionId: string | null;
	paymentId: string | null;
	amountCentavos: number;
	payload: unknown;
}): Promise<{ handled: boolean; confirmed: boolean; needsRefund: boolean; hotelId: string | null }> {
	const result = await db.transaction(async (tx) => {
		const [dup] = await tx.select({ id: diningPayments.id }).from(diningPayments).where(eq(diningPayments.paymongoEventId, args.eventId)).limit(1);
		if (dup) return { handled: false, confirmed: false, needsRefund: false, hotelId: null as string | null, paymentRowId: null as string | null };

		const [order] = await tx.select().from(diningOrders).where(eq(diningOrders.id, args.orderId)).for('update');
		if (!order) {
			console.error('paymongo webhook: dining order not found', args.orderId);
			return { handled: false, confirmed: false, needsRefund: false, hotelId: null, paymentRowId: null };
		}

		// Reuse this checkout's pending row, or add one (e.g. a payment on a session we expired).
		const [pending] = args.sessionId
			? await tx.select().from(diningPayments).where(and(eq(diningPayments.orderId, order.id), eq(diningPayments.paymongoCheckoutSessionId, args.sessionId))).limit(1)
			: [];
		const values = {
			status: 'paid',
			paymongoPaymentId: args.paymentId,
			paymongoEventId: args.eventId,
			amountCentavos: args.amountCentavos,
			rawPayload: args.payload as object,
			paidAt: new Date()
		};
		let paymentRowId: string;
		if (pending && pending.status !== 'paid') {
			await tx.update(diningPayments).set(values).where(eq(diningPayments.id, pending.id));
			paymentRowId = pending.id;
		} else {
			const [row] = await tx
				.insert(diningPayments)
				.values({ hotelId: order.hotelId, orderId: order.id, kind: 'payment', provider: 'paymongo', paymongoCheckoutSessionId: args.sessionId, ...values })
				.returning({ id: diningPayments.id });
			paymentRowId = row!.id;
		}

		const [hotel] = await tx.select({ timezone: hotels.timezone }).from(hotels).where(eq(hotels.id, order.hotelId)).limit(1);
		const businessDate = businessDateFor(hotel?.timezone ?? 'Asia/Manila');

		// Post to Finance's Undeposited Funds, as room payments do; a later payout is a transfer to the bank.
		const [settings] = await tx
			.select({ autoPost: financeSettings.autoPostOnlinePayments, undeposited: financeSettings.undepositedAccountId })
			.from(financeSettings)
			.where(eq(financeSettings.hotelId, order.hotelId))
			.limit(1);
		let movementId: string | null = null;
		if (settings?.autoPost && settings.undeposited) {
			try {
				movementId = await recordCashMovement(
					{
						hotelId: order.hotelId,
						businessDate,
						direction: 'in',
						category: 'dining_revenue',
						cashAccountId: settings.undeposited,
						amountCentavos: args.amountCentavos,
						counterpartyType: 'guest',
						counterpartyName: order.guestName,
						sourceType: 'dining_payment',
						sourceId: paymentRowId,
						memo: `Dining ${order.code}: online payment (PayMongo)`
					},
					tx
				);
				await tx.update(diningPayments).set({ cashMovementId: movementId }).where(eq(diningPayments.id, paymentRowId));
			} catch (e) {
				// Never fail a real payment over a bookkeeping post (a closed day, say): log it to reconcile.
				console.error('paymongo webhook: could not post dining cash movement', order.id, e);
			}
		}

		if (order.status !== 'pending_payment') {
			// Cancelled/expired before the payment landed, or paid twice: keep the money, flag a refund.
			const alreadyPaid = order.paymentStatus === 'paid';
			if (!alreadyPaid) {
				await tx
					.update(diningOrders)
					.set({ paymentStatus: 'paid', paymentMethod: 'paymongo', businessDate, cashMovementId: movementId, paidAt: new Date(), updatedAt: new Date() })
					.where(eq(diningOrders.id, order.id));
			}
			console.error('paymongo webhook: dining payment needs a refund', order.id, paymentRowId, order.status);
			return { handled: true, confirmed: false, needsRefund: true, hotelId: order.hotelId, paymentRowId };
		}

		if (args.amountCentavos !== order.totalCentavos) {
			console.warn(`paymongo webhook: dining order ${order.id} paid ${args.amountCentavos}, expected ${order.totalCentavos}`);
		}
		await tx
			.update(diningOrders)
			.set({
				status: 'new',
				paymentStatus: 'paid',
				paymentMethod: 'paymongo',
				businessDate,
				cashAccountId: settings?.undeposited ?? null,
				cashMovementId: movementId,
				paidAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(diningOrders.id, order.id));
		return { handled: true, confirmed: true, needsRefund: false, hotelId: order.hotelId, paymentRowId };
	});

	if (!result.handled || !result.hotelId) return { handled: result.handled, confirmed: false, needsRefund: false, hotelId: result.hotelId };

	await writeAudit({
		hotelId: result.hotelId,
		actor: null,
		action: 'dining_order.paymongo_paid',
		entityType: 'dining_order',
		entityId: args.orderId,
		after: { paymentId: result.paymentRowId, amountCentavos: args.amountCentavos, eventId: args.eventId, confirmed: result.confirmed, needsRefund: result.needsRefund }
	});

	if (result.confirmed) {
		const bir = await getBirSettings(result.hotelId).catch(() => null);
		if (bir?.autoIssueReceiptOnPayment) {
			try {
				await issueDiningDocument(result.hotelId, args.orderId, 'official_receipt', null);
			} catch (e) {
				console.warn('paymongo webhook: could not issue dining official receipt', args.orderId, e);
			}
		}
		await sendDiningOrderEmail(args.orderId, 'confirmation').catch((e) => console.error('dining confirmation email failed', args.orderId, e));
	}
	return { handled: true, confirmed: result.confirmed, needsRefund: result.needsRefund, hotelId: result.hotelId };
}

/** Records a declined attempt for staff visibility. It does not touch the order: the guest may retry. */
export async function recordDiningPaymentFailure(args: { eventId: string; orderId: string; sessionId: string | null; paymentId: string | null; amountCentavos: number; payload: unknown }) {
	const [dup] = await db.select({ id: diningPayments.id }).from(diningPayments).where(eq(diningPayments.paymongoEventId, args.eventId)).limit(1);
	if (dup) return;
	const [order] = await db.select({ hotelId: diningOrders.hotelId }).from(diningOrders).where(eq(diningOrders.id, args.orderId)).limit(1);
	if (!order) return;
	await db.insert(diningPayments).values({
		hotelId: order.hotelId,
		orderId: args.orderId,
		kind: 'payment',
		status: 'failed',
		provider: 'paymongo',
		amountCentavos: args.amountCentavos,
		paymongoCheckoutSessionId: args.sessionId,
		paymongoPaymentId: args.paymentId,
		paymongoEventId: args.eventId,
		rawPayload: args.payload as object
	});
}

/** Releases online orders whose payment never arrived. Cheap enough to call opportunistically. */
export async function expirePendingDiningOrders(opts: { hotelId?: string; olderThanMinutes?: number; now?: Date } = {}): Promise<number> {
	const cutoff = new Date((opts.now ?? new Date()).getTime() - (opts.olderThanMinutes ?? PENDING_PAYMENT_MINUTES) * 60_000);
	const stale = await db
		.select({ id: diningOrders.id, hotelId: diningOrders.hotelId })
		.from(diningOrders)
		.where(and(eq(diningOrders.status, 'pending_payment'), lt(diningOrders.createdAt, cutoff), opts.hotelId ? eq(diningOrders.hotelId, opts.hotelId) : undefined));

	let released = 0;
	for (const o of stale) {
		const sessions = await db.transaction(async (tx) => {
			const [locked] = await tx.select().from(diningOrders).where(eq(diningOrders.id, o.id)).for('update');
			if (!locked || locked.status !== 'pending_payment') return null; // paid or cancelled meanwhile
			await tx
				.update(diningOrders)
				.set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: 'Online payment was not completed in time.', updatedAt: new Date() })
				.where(eq(diningOrders.id, o.id));
			const pending = await tx
				.select({ id: diningPayments.id, session: diningPayments.paymongoCheckoutSessionId })
				.from(diningPayments)
				.where(and(eq(diningPayments.orderId, o.id), eq(diningPayments.kind, 'payment'), eq(diningPayments.status, 'pending')));
			if (pending.length) await tx.update(diningPayments).set({ status: 'expired' }).where(inArray(diningPayments.id, pending.map((p) => p.id)));
			return pending.map((p) => p.session).filter((x): x is string => !!x);
		});
		if (sessions === null) continue;
		released++;
		if (sessions.length) {
			const client = await getPaymongoClient(o.hotelId).catch(() => null);
			for (const s of sessions) await client?.expireCheckoutSession(s).catch(() => {});
		}
	}
	return released;
}

// ---------------------------------------------------------------------------
// The guest's own order: view, cancel, ask to cancel, message
// ---------------------------------------------------------------------------

async function loadGuestOrder(hotelId: string, code: string, token: string) {
	if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
	const [order] = await db
		.select()
		.from(diningOrders)
		.where(and(eq(diningOrders.hotelId, hotelId), eq(diningOrders.code, code.toUpperCase()), eq(diningOrders.accessToken, token)))
		.limit(1);
	return order ?? null;
}

export interface GuestOrderView {
	id: string;
	code: string;
	status: string;
	paymentStatus: string;
	orderType: string;
	payMode: string | null;
	venueTitle: string;
	guestName: string | null;
	remarks: string | null;
	totalCentavos: number;
	vatCentavos: number;
	pickupAt: string | null;
	pickupLocal: { date: string; time: string } | null;
	createdAt: string;
	readyAt: string | null;
	servedAt: string | null;
	cancelRequested: boolean;
	canCancel: boolean;
	canRequestCancel: boolean;
	needsPayment: boolean;
	items: { id: string; name: string; quantity: number; remarks: string | null; addons: string[]; lineTotalCentavos: number }[];
	messages: { id: string; direction: string; body: string; createdAt: string }[];
	refund: { amountCentavos: number; method: string | null; referenceNo: string | null; at: string } | null;
	receipt: { id: string; formattedNo: string } | null;
}

/** The guest's order by code + access token (never by code alone). */
export async function getOrderForGuest(hotelId: string, timezone: string, code: string, token: string): Promise<GuestOrderView | null> {
	const order = await loadGuestOrder(hotelId, code, token);
	if (!order) return null;
	const [venue] = await db.select({ title: diningItems.title }).from(diningItems).where(eq(diningItems.id, order.diningItemId)).limit(1);
	const items = await db.select().from(diningOrderItems).where(eq(diningOrderItems.orderId, order.id)).orderBy(asc(diningOrderItems.sortOrder));
	const addons = items.length ? await db.select().from(diningOrderItemAddons).where(inArray(diningOrderItemAddons.orderItemId, items.map((i) => i.id))) : [];
	const messages = await db.select().from(diningOrderMessages).where(eq(diningOrderMessages.orderId, order.id)).orderBy(asc(diningOrderMessages.createdAt));
	const [refund] = await db
		.select()
		.from(diningPayments)
		.where(and(eq(diningPayments.orderId, order.id), eq(diningPayments.kind, 'refund'), eq(diningPayments.status, 'paid')))
		.orderBy(desc(diningPayments.createdAt))
		.limit(1);
	const [receipt] = await db
		.select({ id: documents.id, formattedNo: documents.formattedNo })
		.from(documents)
		.where(and(eq(documents.hotelId, hotelId), eq(documents.diningOrderId, order.id), eq(documents.type, 'official_receipt'), eq(documents.status, 'issued')))
		.limit(1);

	const paid = order.paymentStatus === 'paid';
	const early = order.status === 'pending_payment' || order.status === 'new';
	return {
		id: order.id,
		code: order.code,
		status: order.status,
		paymentStatus: order.paymentStatus,
		orderType: order.orderType,
		payMode: order.payMode,
		venueTitle: venue?.title ?? '',
		guestName: order.guestName,
		remarks: order.remarks,
		totalCentavos: order.totalCentavos,
		vatCentavos: order.vatCentavos,
		pickupAt: order.pickupAt?.toISOString() ?? null,
		pickupLocal: order.pickupAt ? localParts(order.pickupAt, timezone) : null,
		createdAt: order.createdAt.toISOString(),
		readyAt: order.readyAt?.toISOString() ?? null,
		servedAt: order.servedAt?.toISOString() ?? null,
		cancelRequested: !!order.cancelRequestedAt,
		// Unpaid and not started: the guest may cancel it themselves.
		canCancel: !paid && early,
		// Paid: ask the restaurant, until the food is ready.
		canRequestCancel: paid && ['new', 'accepted', 'preparing'].includes(order.status) && !order.cancelRequestedAt,
		needsPayment: order.status === 'pending_payment' && order.payMode === 'online',
		items: items.map((i) => ({
			id: i.id,
			name: i.name,
			quantity: i.quantity,
			remarks: i.remarks,
			addons: addons.filter((a) => a.orderItemId === i.id).map((a) => a.name),
			lineTotalCentavos: i.lineTotalCentavos
		})),
		messages: messages.map((m) => ({ id: m.id, direction: m.direction, body: m.body, createdAt: m.createdAt.toISOString() })),
		refund: refund ? { amountCentavos: refund.amountCentavos, method: refund.method, referenceNo: refund.referenceNo, at: (refund.paidAt ?? refund.createdAt).toISOString() } : null,
		receipt: receipt ?? null
	};
}

/** A guest cancels an order they have not paid for and the kitchen has not started. */
export async function cancelDiningOrderAsGuest(hotelId: string, code: string, token: string): Promise<void> {
	const found = await loadGuestOrder(hotelId, code, token);
	if (!found) throw new OrderError('We could not find that order.');
	const sessions = await db.transaction(async (tx) => {
		const [order] = await tx.select().from(diningOrders).where(eq(diningOrders.id, found.id)).for('update');
		if (!order) throw new OrderError('We could not find that order.');
		if (order.paymentStatus !== 'unpaid') throw new OrderError('This order is paid. Please send a cancellation request instead.');
		if (order.status !== 'pending_payment' && order.status !== 'new') throw new OrderError('The kitchen has already started this order. Please contact the restaurant.');
		await tx.update(diningOrders).set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: 'Cancelled by the guest.', updatedAt: new Date() }).where(eq(diningOrders.id, order.id));
		const pending = await tx
			.select({ id: diningPayments.id, session: diningPayments.paymongoCheckoutSessionId })
			.from(diningPayments)
			.where(and(eq(diningPayments.orderId, order.id), eq(diningPayments.kind, 'payment'), eq(diningPayments.status, 'pending')));
		if (pending.length) await tx.update(diningPayments).set({ status: 'expired' }).where(inArray(diningPayments.id, pending.map((p) => p.id)));
		return pending.map((p) => p.session).filter((x): x is string => !!x);
	});
	if (sessions.length) {
		const client = await getPaymongoClient(hotelId).catch(() => null);
		for (const s of sessions) await client?.expireCheckoutSession(s).catch(() => {});
	}
	await writeAudit({ hotelId, actor: null, action: 'dining_order.guest_cancel', entityType: 'dining_order', entityId: found.id });
}

/** A guest asks the restaurant to cancel an order they already paid for. Staff answer it. */
export async function requestDiningCancellation(hotelId: string, code: string, token: string, note: string): Promise<void> {
	const found = await loadGuestOrder(hotelId, code, token);
	if (!found) throw new OrderError('We could not find that order.');
	if (found.paymentStatus !== 'paid') throw new OrderError('This order has not been paid, so you can cancel it directly.');
	if (!['new', 'accepted', 'preparing'].includes(found.status)) throw new OrderError('This order is already ready or finished. Please contact the restaurant.');
	if (found.cancelRequestedAt) throw new OrderError('You have already asked to cancel this order. The restaurant will reply here.');
	const text = note.trim().slice(0, 500);
	await db.transaction(async (tx) => {
		await tx.update(diningOrders).set({ cancelRequestedAt: new Date(), cancelRequestNote: text || null, updatedAt: new Date() }).where(eq(diningOrders.id, found.id));
		await tx.insert(diningOrderMessages).values({ hotelId, orderId: found.id, direction: 'guest', body: `Cancellation requested${text ? `: ${text}` : '.'}` });
	});
	await writeAudit({ hotelId, actor: null, action: 'dining_order.cancel_requested', entityType: 'dining_order', entityId: found.id, after: { note: text } });
}

/** Staff answer a cancellation request: decline it, or approve it (the order is cancelled and a refund is then due). */
export async function respondToDiningCancellation(args: { hotelId: string; orderId: string; approve: boolean; message?: string; actor: Actor }): Promise<void> {
	await db.transaction(async (tx) => {
		const [order] = await tx.select().from(diningOrders).where(and(eq(diningOrders.id, args.orderId), eq(diningOrders.hotelId, args.hotelId))).for('update');
		if (!order) throw new OrderError('That order could not be found.');
		if (!order.cancelRequestedAt) throw new OrderError('There is no cancellation request on this order.');
		const note = args.message?.trim().slice(0, 500);
		if (args.approve) {
			if (!['new', 'accepted', 'preparing'].includes(order.status)) throw new OrderError(`A ${order.status} order can't be cancelled.`);
			await tx
				.update(diningOrders)
				.set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: 'Cancelled at the guest\'s request.', cancelRequestedAt: null, updatedAt: new Date() })
				.where(eq(diningOrders.id, order.id));
		} else {
			await tx.update(diningOrders).set({ cancelRequestedAt: null, updatedAt: new Date() }).where(eq(diningOrders.id, order.id));
		}
		await tx.insert(diningOrderMessages).values({
			hotelId: args.hotelId,
			orderId: order.id,
			direction: 'staff',
			authorUserId: args.actor?.id ?? null,
			body: note || (args.approve ? 'Your order has been cancelled. We will arrange your refund.' : 'We are unable to cancel this order as it is already being prepared.')
		});
	});
	await writeAudit({ hotelId: args.hotelId, actor: args.actor, action: args.approve ? 'dining_order.cancel_approved' : 'dining_order.cancel_declined', entityType: 'dining_order', entityId: args.orderId });
}

export async function postGuestMessage(hotelId: string, code: string, token: string, body: string): Promise<void> {
	const order = await loadGuestOrder(hotelId, code, token);
	if (!order) throw new OrderError('We could not find that order.');
	const text = body.trim();
	if (!text) throw new OrderError('Type a message first.');
	if (text.length > 1000) throw new OrderError('Please keep messages under 1,000 characters.');
	const [{ n } = { n: 0 }] = await db
		.select({ n: sql<number>`count(*)` })
		.from(diningOrderMessages)
		.where(and(eq(diningOrderMessages.orderId, order.id), eq(diningOrderMessages.direction, 'guest'), sql`${diningOrderMessages.createdAt} > now() - interval '1 hour'`));
	if (Number(n) >= 10) throw new OrderError('That is a lot of messages in a short time. Please wait a little.');
	await db.insert(diningOrderMessages).values({ hotelId, orderId: order.id, direction: 'guest', body: text });
}

export async function postStaffMessage(args: { hotelId: string; orderId: string; body: string; actor: Actor }): Promise<void> {
	const text = args.body.trim();
	if (!text) throw new OrderError('Type a message first.');
	if (text.length > 1000) throw new OrderError('Please keep messages under 1,000 characters.');
	const [order] = await db.select({ id: diningOrders.id }).from(diningOrders).where(and(eq(diningOrders.id, args.orderId), eq(diningOrders.hotelId, args.hotelId))).limit(1);
	if (!order) throw new OrderError('That order could not be found.');
	await db.insert(diningOrderMessages).values({ hotelId: args.hotelId, orderId: order.id, direction: 'staff', body: text, authorUserId: args.actor?.id ?? null });
}

export async function listOrderMessages(hotelId: string, orderId: string) {
	return db.select().from(diningOrderMessages).where(and(eq(diningOrderMessages.hotelId, hotelId), eq(diningOrderMessages.orderId, orderId))).orderBy(asc(diningOrderMessages.createdAt));
}

/** Staff opened the thread: mark the guest's messages as read. */
export async function markGuestMessagesRead(hotelId: string, orderId: string): Promise<void> {
	await db
		.update(diningOrderMessages)
		.set({ readAt: new Date() })
		.where(and(eq(diningOrderMessages.hotelId, hotelId), eq(diningOrderMessages.orderId, orderId), eq(diningOrderMessages.direction, 'guest'), sql`${diningOrderMessages.readAt} is null`));
}

// ---------------------------------------------------------------------------
// Manual refund
// ---------------------------------------------------------------------------

/**
 * Records a refund the restaurant has already sent back to the guest (outside the app: PayMongo's
 * dashboard, GCash, a bank transfer or cash) with its reference and an optional photo of the receipt.
 * Posts a cash-out to the ledger (category `refund`) and tells the guest on their tracking page. No
 * money moves automatically. The refund can't exceed what was paid.
 */
export async function recordDiningRefund(args: {
	hotelId: string;
	orderId: string;
	amountCentavos: number;
	method: RefundMethod;
	referenceNo?: string | null;
	note?: string | null;
	proofUrl?: string | null;
	actor: Actor;
}): Promise<{ refundedCentavos: number; fullyRefunded: boolean }> {
	if (!(REFUND_METHODS as readonly string[]).includes(args.method)) throw new OrderError('Choose how the refund was sent.');
	if (!Number.isInteger(args.amountCentavos) || args.amountCentavos <= 0) throw new OrderError('Enter the refund amount.');

	const [order] = await db.select().from(diningOrders).where(and(eq(diningOrders.id, args.orderId), eq(diningOrders.hotelId, args.hotelId))).limit(1);
	if (!order) throw new OrderError('That order could not be found.');
	if (order.paymentStatus !== 'paid') throw new OrderError('Only a paid order can be refunded.');

	const prior = await db
		.select({ amount: diningPayments.amountCentavos })
		.from(diningPayments)
		.where(and(eq(diningPayments.orderId, order.id), eq(diningPayments.kind, 'refund'), eq(diningPayments.status, 'paid')));
	const alreadyRefunded = prior.reduce((s, r) => s + r.amount, 0);
	const refundable = order.totalCentavos - alreadyRefunded;
	if (args.amountCentavos > refundable) throw new OrderError(`At most ${peso(refundable)} can still be refunded on this order.`);

	// Where the money leaves from: the drawer for cash (needs an open shift), otherwise the account it came into.
	const [hotel] = await db.select({ timezone: hotels.timezone }).from(hotels).where(eq(hotels.id, args.hotelId)).limit(1);
	const businessDate = businessDateFor(hotel?.timezone ?? 'Asia/Manila');
	let cashAccountId: string;
	let shiftId: string | null = null;
	if (args.method === 'cash') {
		const acct = await resolvePaymentAccount(args.hotelId, 'cash');
		cashAccountId = acct.cashAccountId;
		shiftId = acct.shiftId;
	} else if (order.cashAccountId && order.paymentMethod !== 'cash') {
		cashAccountId = order.cashAccountId;
	} else {
		cashAccountId = (await resolvePaymentAccount(args.hotelId, 'card')).cashAccountId;
	}

	const result = await db.transaction(async (tx) => {
		const [locked] = await tx.select().from(diningOrders).where(eq(diningOrders.id, order.id)).for('update');
		if (!locked || locked.paymentStatus !== 'paid') throw new OrderError('Only a paid order can be refunded.');

		const [row] = await tx
			.insert(diningPayments)
			.values({
				hotelId: args.hotelId,
				orderId: order.id,
				kind: 'refund',
				status: 'paid',
				provider: 'manual',
				method: args.method,
				amountCentavos: args.amountCentavos,
				referenceNo: args.referenceNo?.trim() || null,
				proofUrl: args.proofUrl ?? null,
				note: args.note?.trim() || null,
				createdByUserId: args.actor?.id ?? null,
				paidAt: new Date()
			})
			.returning({ id: diningPayments.id });

		const movementId = await recordCashMovement(
			{
				hotelId: args.hotelId,
				businessDate,
				direction: 'out',
				category: 'refund',
				cashAccountId,
				amountCentavos: args.amountCentavos,
				counterpartyType: 'guest',
				counterpartyName: order.guestName,
				sourceType: 'dining_refund',
				sourceId: row!.id,
				shiftId,
				memo: `Dining ${order.code}: refund via ${METHOD_LABEL[args.method]}${args.referenceNo ? ` (ref ${args.referenceNo.trim()})` : ''}`,
				actor: args.actor
			},
			tx
		);
		await tx.update(diningPayments).set({ cashMovementId: movementId }).where(eq(diningPayments.id, row!.id));

		const full = alreadyRefunded + args.amountCentavos >= order.totalCentavos;
		await tx
			.update(diningOrders)
			.set({ paymentStatus: full ? 'refunded' : 'paid', cancelRequestedAt: null, updatedAt: new Date() })
			.where(eq(diningOrders.id, order.id));
		await tx.insert(diningOrderMessages).values({
			hotelId: args.hotelId,
			orderId: order.id,
			direction: 'staff',
			authorUserId: args.actor?.id ?? null,
			body: `We have sent your refund of ${peso(args.amountCentavos)} via ${METHOD_LABEL[args.method]}${args.referenceNo?.trim() ? ` (reference ${args.referenceNo.trim()})` : ''}.`
		});
		return { full, refundId: row!.id };
	});

	await writeAudit({
		hotelId: args.hotelId,
		actor: args.actor,
		action: 'dining_order.refund',
		entityType: 'dining_order',
		entityId: order.id,
		after: { refundId: result.refundId, amountCentavos: args.amountCentavos, method: args.method, referenceNo: args.referenceNo ?? null }
	});
	return { refundedCentavos: alreadyRefunded + args.amountCentavos, fullyRefunded: result.full };
}

// Re-exported so the webhook and pages share one place for the finance error type.
export { FinanceError };
