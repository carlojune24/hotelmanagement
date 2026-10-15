import { PayMongoError } from '@mm/paymongo';
import type { CheckoutSession } from '@mm/paymongo';
import { and, asc, eq, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { db } from '../db/index';
import { diningOrders, orders, paymentAttempts, type PaymentAttemptRow } from '../db/schema/index';
import { appendReconEvent, type ReconEventType, type ReconTrigger } from '../finance/reconciliation-trail';
import { confirmDiningPayment } from '../dining-online';
import { sendPaymentStatusEmail } from '../email/send-payment-status';
import { getPaymongoClient } from './client';
import { confirmRoomPayment } from './confirm-room-payment';

/**
 * Asks PayMongo directly whether a checkout was paid, and confirms the booking if it was, so a payment never
 * depends on PayMongo's webhook reaching us (a tunnel that is down, an outage, a missing event subscription).
 *
 * Every checkout session we create has a row in `payment_attempts`. This module:
 *  - `verifyAttempt` checks one attempt with PayMongo and records the outcome;
 *  - `verifyOrderNow` is what a guest's page does on load (so a refresh recovers at once), throttled;
 *  - `runPaymentVerify` is the background worker: every minute it checks the attempts that are due, with a gentler
 *    schedule the longer an attempt stays open, and it never gives up on one that can still be paid.
 *
 * NB: PayMongo leaves a checkout session's own `status` as `active` after it is paid. A session is paid when its
 * `payments[]` holds a payment whose own status is `paid`.
 */

const MIN = 60_000;
/** The worker asks again this long after the previous look: quick at first, then gentler, never zero. */
function nextDelayMs(checks: number): number {
	if (checks < 10) return MIN; // the first ~10 minutes: every minute
	if (checks < 22) return 5 * MIN; // then every 5 minutes for the first hour
	return 15 * MIN; // then every 15 minutes for as long as the session can still be paid
}
/** A booking whose attempt is still unconfirmed this long gets the "still checking" email, once. */
const DELAYED_EMAIL_AFTER_MS = 10 * MIN;
/** An attempt on a cancelled order is only watched for this long (the session was expired at PayMongo anyway). */
const CANCELLED_WATCH_MS = 7 * 24 * 60 * MIN;

export type VerifyState = 'paid' | 'open' | 'expired' | 'error';
export interface VerifyOutcome {
	state: VerifyState;
	/** True when THIS call is the one that confirmed the booking. */
	confirmedNow: boolean;
	paymentId?: string;
	error?: string;
}

/** The checkout session as PayMongo returned it, minus the customer's billing block, for the payment row. */
function sanitizedSession(session: CheckoutSession) {
	const { billing: _billing, ...attributes } = session.attributes as Record<string, unknown>;
	return { id: session.id, type: session.type, attributes };
}

async function schedule(a: PaymentAttemptRow, patch: Partial<typeof paymentAttempts.$inferInsert>) {
	await db
		.update(paymentAttempts)
		.set({
			checks: a.checks + 1,
			lastCheckedAt: new Date(),
			nextCheckAt: new Date(Date.now() + nextDelayMs(a.checks + 1)),
			...patch
		})
		.where(eq(paymentAttempts.id, a.id));
}

async function resolve(a: PaymentAttemptRow, status: 'paid' | 'expired', patch: Partial<typeof paymentAttempts.$inferInsert> = {}) {
	await db
		.update(paymentAttempts)
		.set({ status, checks: a.checks + 1, lastCheckedAt: new Date(), resolvedAt: new Date(), lastError: null, ...patch })
		.where(eq(paymentAttempts.id, a.id));
}

/** Once one payment settles an order, its other open checkout links must not be payable too. */
async function closeSiblings(a: PaymentAttemptRow) {
	const siblings = await db
		.select()
		.from(paymentAttempts)
		.where(
			and(
				eq(paymentAttempts.status, 'open'),
				ne(paymentAttempts.id, a.id),
				a.orderId ? eq(paymentAttempts.orderId, a.orderId) : a.diningOrderId ? eq(paymentAttempts.diningOrderId, a.diningOrderId) : sql`false`
			)
		);
	if (siblings.length === 0) return;
	const client = await getPaymongoClient(a.hotelId).catch(() => null);
	for (const s of siblings) {
		await client?.expireCheckoutSession(s.checkoutSessionId).catch(() => {});
		await db.update(paymentAttempts).set({ status: 'expired', resolvedAt: new Date() }).where(eq(paymentAttempts.id, s.id));
	}
}

/** The booking's status, for the before / after on the money trail. */
async function orderStatusOf(a: PaymentAttemptRow): Promise<string | null> {
	if (a.scope === 'dining' && a.diningOrderId) {
		const [d] = await db.select({ s: diningOrders.status }).from(diningOrders).where(eq(diningOrders.id, a.diningOrderId)).limit(1);
		return d?.s ?? null;
	}
	if (a.orderId) {
		const [o] = await db.select({ s: orders.status }).from(orders).where(eq(orders.id, a.orderId)).limit(1);
		return o?.s ?? null;
	}
	return null;
}

/** Writes to the money trail. Never lets a failure here undo or block a real payment: it is logged loudly instead. */
async function trail(a: PaymentAttemptRow, eventType: ReconEventType, trigger: ReconTrigger, extra: Omit<Parameters<typeof appendReconEvent>[0], 'hotelId' | 'eventType' | 'scope' | 'trigger'>) {
	try {
		await appendReconEvent({
			hotelId: a.hotelId,
			eventType,
			scope: a.scope === 'dining' ? 'dining' : 'room',
			orderId: a.orderId,
			diningOrderId: a.diningOrderId,
			attemptId: a.id,
			checkoutSessionId: a.checkoutSessionId,
			attemptStartedAt: a.createdAt,
			trigger,
			...extra
		});
	} catch (e) {
		console.error('[paymongo-verify] could not write the money trail', a.id, eventType, e);
	}
}

/** Checks one attempt with PayMongo. Safe to call at any time and any number of times. `trigger` is what prompted the look (kept on the trail). */
export async function verifyAttempt(attemptId: string, trigger: ReconTrigger = 'worker'): Promise<VerifyOutcome> {
	const [a] = await db.select().from(paymentAttempts).where(eq(paymentAttempts.id, attemptId)).limit(1);
	if (!a) return { state: 'error', confirmedNow: false, error: 'attempt not found' };
	if (a.status === 'paid') return { state: 'paid', confirmedNow: false, paymentId: a.paymongoPaymentId ?? undefined };
	if (a.status === 'expired') return { state: 'expired', confirmedNow: false };

	let session: CheckoutSession;
	try {
		const client = await getPaymongoClient(a.hotelId);
		session = await client.retrieveCheckoutSession(a.checkoutSessionId);
	} catch (e) {
		// PayMongo has no such session: it can never be paid.
		if (e instanceof PayMongoError && e.status === 404) {
			await resolve(a, 'expired', { lastSessionStatus: 'not_found' });
			return { state: 'expired', confirmedNow: false };
		}
		const error =
			e instanceof PayMongoError
				? e.status === 401
					? 'PayMongo rejected the saved secret key.'
					: `PayMongo returned HTTP ${e.status}.`
				: e instanceof Error
					? e.message
					: 'Could not reach PayMongo.';
		// Never give up on an attempt that may still be paid: record why and look again later.
		await schedule(a, { lastError: error.slice(0, 300) });
		return { state: 'error', confirmedNow: false, error };
	}

	const attrs = session.attributes;
	const paid = (attrs.payments ?? []).find((p) => p.attributes?.status === 'paid');

	if (paid) {
		const amountCentavos = paid.attributes.amount;
		const currency = paid.attributes.currency ?? 'PHP';
		const intentId = attrs.payment_intent?.id ?? (paid.attributes.payment_intent_id as string | undefined) ?? null;
		const eventId = `reconcile:${paid.id}`;
		let confirmedNow = false;
		let recorded = false;
		let paymentRowId: string | null = null;
		let needsRefund = false;
		const statusBefore = await orderStatusOf(a).catch(() => null);
		try {
			if (a.scope === 'dining') {
				const diningOrderId = a.diningOrderId ?? attrs.metadata?.diningOrderId;
				if (!diningOrderId) throw new Error('dining order unknown');
				const r = await confirmDiningPayment({
					eventId,
					orderId: diningOrderId,
					sessionId: session.id,
					paymentId: paid.id,
					amountCentavos,
					payload: { source: 'paymongo_verify', checkout_session: sanitizedSession(session) }
				});
				confirmedNow = r.confirmed;
				recorded = r.handled;
				needsRefund = r.needsRefund;
				paymentRowId = r.paymentRowId ?? null;
			} else {
				const orderId = a.orderId ?? attrs.metadata?.orderId;
				if (!orderId) throw new Error('order unknown');
				const r = await confirmRoomPayment({
					eventId,
					orderId,
					sessionId: session.id,
					paymentId: paid.id,
					amountCentavos,
					currency,
					payload: { source: 'paymongo_verify', checkout_session: sanitizedSession(session) }
				});
				confirmedNow = r.confirmedNow;
				recorded = r.recorded;
				paymentRowId = r.paymentRowId ?? null;
				needsRefund = statusBefore === 'cancelled';
			}
		} catch (e) {
			// Recording failed (a database hiccup): keep it open and try again, the money is safe at PayMongo.
			const error = e instanceof Error ? e.message : 'could not record the payment';
			console.error('[paymongo-verify] could not record a paid checkout', a.id, paid.id, e);
			// Once per attempt: the worker retries every minute and the trail should say it happened, not repeat it.
			if (!(a.lastError ?? '').startsWith('Paid at PayMongo but not recorded')) {
				await trail(a, 'reconcile_failed', trigger, {
					paymongoPaymentId: paid.id,
					paymentIntentId: intentId,
					amountCentavos,
					expectedAmountCentavos: a.amountCentavos,
					paymongoPaidAt: paid.attributes.paid_at ? new Date(paid.attributes.paid_at * 1000) : null,
					orderStatusBefore: statusBefore,
					checks: a.checks + 1,
					error
				});
			}
			await schedule(a, { lastError: `Paid at PayMongo but not recorded yet: ${error}`.slice(0, 300), lastSessionStatus: attrs.status });
			return { state: 'error', confirmedNow: false, error };
		}
		// A payment WE just recorded, because PayMongo's webhook had not (a webhook that beat us leaves nothing here).
		if (recorded) {
			const statusAfter = await orderStatusOf(a).catch(() => null);
			const paidAt = paid.attributes.paid_at ? new Date(paid.attributes.paid_at * 1000) : null;
			const common = {
				paymentRowId,
				paymongoPaymentId: paid.id,
				paymentIntentId: intentId,
				amountCentavos,
				expectedAmountCentavos: a.amountCentavos,
				paymongoPaidAt: paidAt,
				orderStatusBefore: statusBefore,
				orderStatusAfter: statusAfter,
				checks: a.checks + 1
			};
			await trail(a, 'reconciled', trigger, {
				...common,
				details: {
					method: ((paid.attributes as Record<string, unknown>).source as { type?: string } | undefined)?.type ?? null,
					currency,
					sessionStatus: attrs.status,
					bookingConfirmed: confirmedNow
				}
			});
			if (amountCentavos !== a.amountCentavos) {
				await trail(a, 'amount_mismatch', trigger, { ...common, details: { note: 'PayMongo took a different amount than the checkout asked for' } });
			}
			if (needsRefund) {
				await trail(a, 'paid_after_cancel', trigger, { ...common, details: { note: 'Paid after the booking was cancelled: refund the guest' } });
			}
		}
		await resolve(a, 'paid', {
			paymongoPaymentId: paid.id,
			paymentIntentId: intentId,
			paidAt: paid.attributes.paid_at ? new Date(paid.attributes.paid_at * 1000) : new Date(),
			lastSessionStatus: attrs.status
		});
		await closeSiblings(a);
		return { state: 'paid', confirmedNow, paymentId: paid.id };
	}

	// Not paid. An expired session can never be paid now.
	if (attrs.status === 'expired') {
		await resolve(a, 'expired', { lastSessionStatus: 'expired' });
		return { state: 'expired', confirmedNow: false };
	}
	await schedule(a, { lastSessionStatus: attrs.status, lastError: null });
	return { state: 'open', confirmedNow: false };
}

/**
 * What a guest's page does each time it loads while a payment is pending: look at that order's open attempts with
 * PayMongo, at most once per `minGapMs`, so a refresh, a hard refresh, or several tabs cost PayMongo almost nothing
 * and still recover the booking within seconds of the payment.
 */
export async function verifyOrderNow(
	target: { orderId: string } | { diningOrderId: string },
	minGapMs = 4000,
	trigger: ReconTrigger = 'guest_page'
): Promise<{ confirmedNow: boolean; paid: boolean; unknown: boolean }> {
	const where = 'orderId' in target ? eq(paymentAttempts.orderId, target.orderId) : eq(paymentAttempts.diningOrderId, target.diningOrderId);
	const cutoff = new Date(Date.now() - minGapMs);
	// Claiming the look in the same statement is the throttle: two tabs cannot both ask PayMongo.
	const claimed = await db
		.update(paymentAttempts)
		.set({ lastCheckedAt: new Date() })
		.where(and(where, eq(paymentAttempts.status, 'open'), or(isNull(paymentAttempts.lastCheckedAt), lt(paymentAttempts.lastCheckedAt, cutoff))))
		.returning({ id: paymentAttempts.id });
	let confirmedNow = false;
	let paid = false;
	// `unknown`: PayMongo could not be asked (a bad key, an outage). The caller must not treat that as "unpaid".
	let unknown = false;
	for (const c of claimed) {
		const r = await verifyAttempt(c.id, trigger).catch(() => null);
		if (r?.confirmedNow) confirmedNow = true;
		if (r?.state === 'paid') paid = true;
		if (!r || r.state === 'error') unknown = true;
	}
	return { confirmedNow, paid, unknown };
}

/** Checks every open attempt of a hotel now (a `payment.paid` webhook just told us something was paid). */
export async function verifyOpenAttemptsForHotel(hotelId: string): Promise<void> {
	const open = await db
		.select({ id: paymentAttempts.id })
		.from(paymentAttempts)
		.where(and(eq(paymentAttempts.hotelId, hotelId), eq(paymentAttempts.status, 'open')))
		.orderBy(asc(paymentAttempts.createdAt))
		.limit(50);
	for (const o of open) await verifyAttempt(o.id, 'webhook').catch(() => null);
}

/**
 * The background worker, run every minute by pg-boss. State lives in the database, so it survives restarts, and an
 * attempt that can still be paid is checked again and again until PayMongo says it was paid or can no longer be.
 */
export async function runPaymentVerify(): Promise<{ checked: number; paid: number; errors: number; emailed: number; closed: number }> {
	const out = { checked: 0, paid: 0, errors: 0, emailed: 0, closed: 0 };

	// An attempt on an order that was cancelled a week ago has nothing left to confirm: stop watching it.
	const stale = await db.execute<{ id: string }>(sql`
		update payment_attempts pa set status = 'expired', resolved_at = now()
		where pa.status = 'open' and pa.created_at < now() - ${sql.raw(`interval '${CANCELLED_WATCH_MS / 1000} seconds'`)}
		  and (
		    exists (select 1 from orders o where o.id = pa.order_id and o.status = 'cancelled')
		    or exists (select 1 from dining_orders d where d.id = pa.dining_order_id and d.status = 'cancelled')
		  )
		returning pa.id`);
	out.closed = stale.length;

	const due = await db
		.select({ id: paymentAttempts.id })
		.from(paymentAttempts)
		.where(and(eq(paymentAttempts.status, 'open'), lte(paymentAttempts.nextCheckAt, new Date())))
		.orderBy(asc(paymentAttempts.nextCheckAt))
		.limit(100);

	// A few at a time: PayMongo is polite about bursts and so should we be.
	for (let i = 0; i < due.length; i += 4) {
		const results = await Promise.all(due.slice(i, i + 4).map((d) => verifyAttempt(d.id).catch(() => null)));
		for (const r of results) {
			out.checked += 1;
			if (r?.state === 'paid') out.paid += 1;
			if (r?.state === 'error') out.errors += 1;
		}
	}

	// "Still checking your payment": once, for a booking PayMongo has not confirmed after a while.
	const slow = await db
		.select({ id: paymentAttempts.id })
		.from(paymentAttempts)
		.where(
			and(
				eq(paymentAttempts.status, 'open'),
				isNull(paymentAttempts.delayedEmailAt),
				lt(paymentAttempts.createdAt, new Date(Date.now() - DELAYED_EMAIL_AFTER_MS))
			)
		)
		.limit(50);
	for (const s of slow) {
		const r = await sendPaymentStatusEmail(s.id, 'delayed');
		if (r.ok && !r.skipped) out.emailed += 1;
		// Not applicable (booking no longer pending, or no email address): remember so it is not retried every minute.
		if (r.skipped === 'not-pending' || r.skipped === 'no-email') {
			await db.update(paymentAttempts).set({ delayedEmailAt: new Date() }).where(eq(paymentAttempts.id, s.id));
		}
	}
	return out;
}

/** Orders waiting for payment, for places that need to know whether PayMongo might still pay them. */
export async function hasOpenAttempt(target: { orderId: string } | { diningOrderId: string }): Promise<boolean> {
	const where = 'orderId' in target ? eq(paymentAttempts.orderId, target.orderId) : eq(paymentAttempts.diningOrderId, target.diningOrderId);
	const [r] = await db.select({ id: paymentAttempts.id }).from(paymentAttempts).where(and(where, eq(paymentAttempts.status, 'open'))).limit(1);
	return !!r;
}

