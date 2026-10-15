import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '../db/index';
import { diningOrders, orders, paymentAttempts, payments, paymentReconEvents } from '../db/schema/index';
import { attemptCode } from '../db/schema/payment-attempts';
import { verifyReconChain, type ChainCheck } from './reconciliation-trail';

/**
 * Finance → Reconciliation: where PayMongo and our books disagreed, and how each case ended.
 *
 *  - **Settled**: PayMongo said "paid" but its webhook never reached us, so the verifier (`paymongo/verify.ts`) found
 *    the payment by asking PayMongo and recorded it. Each case is a row on the money trail
 *    (`payment_reconciliation_events`: append-only and hash-chained, see `reconciliation-trail.ts`) with the full story:
 *    when the guest started, when PayMongo took the money, when we found and recorded it, what prompted the look.
 *  - **Needs attention**: a check PayMongo could not answer, a payment PayMongo has but we could not record, a guest who
 *    paid after their booking was cancelled (refund owed), or a payment settled without a trail entry.
 *
 * Read-only: nothing here changes a booking or a payment.
 */

export type ReconTriggerKey = 'guest_page' | 'worker' | 'webhook' | 'hold_sweep' | 'backfill';

export interface SettledRow {
	eventId: string;
	/** Position on the hotel's money trail, and this row's hash (and the previous one's), for tracing and printing. */
	seq: number;
	rowHash: string;
	prevHash: string | null;
	scope: 'room' | 'dining';
	orderId: string | null;
	orderCode: string;
	guestName: string | null;
	/** What PayMongo took, and what the checkout asked for. */
	amountCentavos: number;
	expectedAmountCentavos: number | null;
	amountMismatch: boolean;
	paidAfterCancel: boolean;
	paymongoPaymentId: string;
	paymentIntentId: string | null;
	checkoutSessionId: string | null;
	paymentRowId: string | null;
	attemptCode: string | null;
	attemptStartedAt: Date | null;
	/** When PayMongo took the money, and when we found and recorded it. */
	paymongoPaidAt: Date | null;
	reconciledAt: Date;
	/** How long the payment was missing from our books. */
	missingMs: number | null;
	trigger: string;
	orderStatusBefore: string | null;
	orderStatusAfter: string | null;
	checks: number | null;
	method: string | null;
	backfilled: boolean;
}

export type IssueKind = 'cannot_verify' | 'not_recorded' | 'refund_due' | 'untrailed';

export interface IssueRow {
	kind: IssueKind;
	scope: 'room' | 'dining';
	orderId: string;
	orderCode: string;
	guestName: string | null;
	amountCentavos: number;
	paymongoId: string | null;
	/** Plain-language reason. */
	detail: string;
	since: Date;
	attemptCode: string | null;
	checks: number | null;
	nextCheckAt: Date | null;
}

export interface TrailRow {
	seq: number;
	at: Date;
	eventType: string;
	scope: 'room' | 'dining';
	orderCode: string;
	paymongoPaymentId: string | null;
	amountCentavos: number;
	trigger: string;
	error: string | null;
	rowHash: string;
}

export interface PaymentReconciliation {
	settled: SettledRow[];
	settledTotals: { count: number; amountCentavos: number; avgMissingMs: number | null; maxMissingMs: number | null; mismatches: number };
	issues: IssueRow[];
	/** Checkout links the guest has not paid yet: waiting on the guest, not a discrepancy. */
	waitingOnGuest: number;
	trail: TrailRow[];
	integrity: ChainCheck;
}

export interface ReconciliationFilter {
	/** Business-date range as `YYYY-MM-DD`, in the hotel's timezone. */
	from?: string;
	to?: string;
	scope: 'all' | 'room' | 'dining';
}

export function parseReconciliationFilter(url: URL): ReconciliationFilter {
	const ymd = /^\d{4}-\d{2}-\d{2}$/;
	const from = url.searchParams.get('from') ?? undefined;
	const to = url.searchParams.get('to') ?? undefined;
	const scope = url.searchParams.get('scope');
	return {
		from: from && ymd.test(from) ? from : undefined,
		to: to && ymd.test(to) ? to : undefined,
		scope: scope === 'room' || scope === 'dining' ? scope : 'all'
	};
}

const roomCode = (id: string) => id.slice(0, 8).toUpperCase();
/** `YYYY-MM-DD` at midnight in `tz` as an instant (a small search of the offset, so no date library is needed). */
function startOfDayIn(ymd: string, tz: string): Date {
	const guess = new Date(`${ymd}T00:00:00Z`);
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: tz,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit'
	}).formatToParts(guess);
	const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
	const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
	return new Date(guess.getTime() - (asUtc - guess.getTime()));
}

export async function getPaymentReconciliation(
	hotelId: string,
	timezone: string,
	filter: ReconciliationFilter
): Promise<PaymentReconciliation> {
	const from = filter.from ? startOfDayIn(filter.from, timezone) : null;
	const toExclusive = filter.to ? new Date(startOfDayIn(filter.to, timezone).getTime() + 86_400_000) : null;
	const wantRoom = filter.scope !== 'dining';
	const wantDining = filter.scope !== 'room';

	// ---- the trail rows for the period (every event type; the settled list is built from the `reconciled` ones)
	const e = paymentReconEvents;
	const events = await db
		.select({
			ev: e,
			roomGuest: sql<string | null>`(select g.full_name from orders o join guests g on g.id = o.guest_id where o.id = ${e.orderId})`,
			diningCode: diningOrders.code,
			diningGuest: diningOrders.guestName,
			method: sql<string | null>`${e.details} ->> 'method'`,
			backfilled: sql<boolean>`coalesce((${e.details} ->> 'backfilled')::boolean, false)`
		})
		.from(e)
		.leftJoin(diningOrders, eq(diningOrders.id, e.diningOrderId))
		.where(
			and(
				eq(e.hotelId, hotelId),
				filter.scope === 'all' ? undefined : eq(e.scope, filter.scope),
				from ? gte(e.occurredAt, from) : undefined,
				toExclusive ? lt(e.occurredAt, toExclusive) : undefined
			)
		)
		.orderBy(desc(e.seq))
		.limit(1000);

	const flagged = (payId: string | null, type: string) => !!payId && events.some((x) => x.ev.eventType === type && x.ev.paymongoPaymentId === payId);
	const codeOf = (x: (typeof events)[number]) => (x.ev.scope === 'dining' ? (x.diningCode ?? '—') : x.ev.orderId ? roomCode(x.ev.orderId) : '—');

	const settled: SettledRow[] = events
		.filter((x) => x.ev.eventType === 'reconciled')
		.map((x) => {
			const r = x.ev;
			const missingMs = r.paymongoPaidAt ? Math.max(0, r.occurredAt.getTime() - r.paymongoPaidAt.getTime()) : null;
			return {
				eventId: r.id,
				seq: r.seq,
				rowHash: r.rowHash,
				prevHash: r.prevHash,
				scope: r.scope === 'dining' ? 'dining' : 'room',
				orderId: r.scope === 'dining' ? r.diningOrderId : r.orderId,
				orderCode: codeOf(x),
				guestName: r.scope === 'dining' ? x.diningGuest : x.roomGuest,
				amountCentavos: r.amountCentavos,
				expectedAmountCentavos: r.expectedAmountCentavos,
				amountMismatch: flagged(r.paymongoPaymentId, 'amount_mismatch'),
				paidAfterCancel: flagged(r.paymongoPaymentId, 'paid_after_cancel'),
				paymongoPaymentId: r.paymongoPaymentId ?? '',
				paymentIntentId: r.paymentIntentId,
				checkoutSessionId: r.checkoutSessionId,
				paymentRowId: r.paymentRowId,
				attemptCode: r.attemptId ? attemptCode(r.attemptId) : null,
				attemptStartedAt: r.attemptStartedAt,
				paymongoPaidAt: r.paymongoPaidAt,
				reconciledAt: r.occurredAt,
				missingMs,
				trigger: r.trigger,
				orderStatusBefore: r.orderStatusBefore,
				orderStatusAfter: r.orderStatusAfter,
				checks: r.checks,
				method: x.method,
				backfilled: x.backfilled
			};
		});

	const delays = settled.map((s) => s.missingMs).filter((d): d is number => d != null);
	const settledTotals = {
		count: settled.length,
		amountCentavos: settled.reduce((n, s) => n + s.amountCentavos, 0),
		avgMissingMs: delays.length ? Math.round(delays.reduce((n, d) => n + d, 0) / delays.length) : null,
		maxMissingMs: delays.length ? Math.max(...delays) : null,
		mismatches: settled.filter((s) => s.amountMismatch).length
	};

	const trail: TrailRow[] = events.slice(0, 100).map((x) => ({
		seq: x.ev.seq,
		at: x.ev.occurredAt,
		eventType: x.ev.eventType,
		scope: x.ev.scope === 'dining' ? 'dining' : 'room',
		orderCode: codeOf(x),
		paymongoPaymentId: x.ev.paymongoPaymentId,
		amountCentavos: x.ev.amountCentavos,
		trigger: x.ev.trigger,
		error: x.ev.error,
		rowHash: x.ev.rowHash
	}));

	// ---- needs attention (always "now", whatever the date filter says)
	const issues: IssueRow[] = [];
	const stuck = await db
		.select({
			a: paymentAttempts,
			guest: diningOrders.guestName,
			diningCode: diningOrders.code,
			roomGuest: sql<string | null>`(select g.full_name from orders o join guests g on g.id = o.guest_id where o.id = ${paymentAttempts.orderId})`
		})
		.from(paymentAttempts)
		.leftJoin(diningOrders, eq(diningOrders.id, paymentAttempts.diningOrderId))
		.where(
			and(
				eq(paymentAttempts.hotelId, hotelId),
				eq(paymentAttempts.status, 'open'),
				sql`${paymentAttempts.lastError} is not null`,
				filter.scope === 'all' ? undefined : eq(paymentAttempts.scope, filter.scope)
			)
		)
		.orderBy(paymentAttempts.createdAt)
		.limit(100);
	for (const s of stuck) {
		const a = s.a;
		const orderId = (a.scope === 'dining' ? a.diningOrderId : a.orderId) ?? '';
		const notRecorded = (a.lastError ?? '').startsWith('Paid at PayMongo but not recorded');
		issues.push({
			kind: notRecorded ? 'not_recorded' : 'cannot_verify',
			scope: a.scope === 'dining' ? 'dining' : 'room',
			orderId,
			orderCode: a.scope === 'dining' ? (s.diningCode ?? orderId.slice(0, 8)) : roomCode(orderId),
			guestName: a.scope === 'dining' ? s.guest : s.roomGuest,
			amountCentavos: a.amountCentavos,
			paymongoId: a.paymongoPaymentId ?? a.checkoutSessionId,
			detail: a.lastError ?? '',
			since: a.createdAt,
			attemptCode: attemptCode(a.id),
			checks: a.checks,
			nextCheckAt: a.nextCheckAt
		});
	}

	// Paid after the booking was cancelled: the money is ours to hold until it is refunded.
	if (wantRoom) {
		const due = await db
			.select({
				orderId: orders.id,
				amount: payments.amountCentavos,
				payId: payments.paymongoPaymentId,
				at: payments.createdAt,
				guest: sql<string | null>`(select g.full_name from guests g where g.id = ${orders.guestId})`
			})
			.from(payments)
			.innerJoin(orders, eq(orders.id, payments.orderId))
			.where(
				and(
					eq(orders.hotelId, hotelId),
					eq(orders.status, 'cancelled'),
					eq(payments.provider, 'paymongo'),
					eq(payments.status, 'paid'),
					sql`${payments.purpose} <> 'refund'`,
					sql`not exists (select 1 from payments r where r.order_id = ${payments.orderId} and r.purpose = 'refund' and r.status = 'paid' and r.voided_at is null)`
				)
			)
			.limit(100);
		for (const d of due) {
			issues.push({
				kind: 'refund_due',
				scope: 'room',
				orderId: d.orderId,
				orderCode: roomCode(d.orderId),
				guestName: d.guest,
				amountCentavos: Number(d.amount),
				paymongoId: d.payId,
				detail: 'Paid after the booking was cancelled. Refund the guest.',
				since: d.at,
				attemptCode: null,
				checks: null,
				nextCheckAt: null
			});
		}
	}

	// A payment the verifier recorded that has no entry on the money trail (the write failed): the books have it, the
	// trail does not. Flag it so it is looked at rather than quietly missing.
	const untrailed = await db.execute<{ scope: string; order_id: string; code: string | null; guest: string | null; amount: string; pay_id: string; at: Date }>(sql`
		select 'room' as scope, p.order_id, null as code,
		       (select g.full_name from guests g where g.id = o.guest_id) as guest,
		       p.amount_centavos::text as amount, p.paymongo_payment_id as pay_id, p.created_at as at
		from payments p join orders o on o.id = p.order_id
		where o.hotel_id = ${hotelId} and p.paymongo_event_id like 'reconcile:%'
		  and not exists (select 1 from payment_reconciliation_events e where e.hotel_id = ${hotelId} and e.paymongo_payment_id = p.paymongo_payment_id and e.event_type = 'reconciled')
		union all
		select 'dining', d.order_id, o2.code, o2.guest_name, d.amount_centavos::text, d.paymongo_payment_id, d.created_at
		from dining_payments d join dining_orders o2 on o2.id = d.order_id
		where d.hotel_id = ${hotelId} and d.paymongo_event_id like 'reconcile:%'
		  and not exists (select 1 from payment_reconciliation_events e where e.hotel_id = ${hotelId} and e.paymongo_payment_id = d.paymongo_payment_id and e.event_type = 'reconciled')
		limit 100`);
	for (const u of untrailed) {
		if (filter.scope !== 'all' && u.scope !== filter.scope) continue;
		issues.push({
			kind: 'untrailed',
			scope: u.scope === 'dining' ? 'dining' : 'room',
			orderId: u.order_id,
			orderCode: u.scope === 'dining' ? (u.code ?? '—') : roomCode(u.order_id),
			guestName: u.guest,
			amountCentavos: Number(u.amount),
			paymongoId: u.pay_id,
			detail: 'Recorded by the payment check but missing from the money trail. Tell the developer.',
			since: new Date(u.at),
			attemptCode: null,
			checks: null,
			nextCheckAt: null
		});
	}
	issues.sort((a, b) => a.since.getTime() - b.since.getTime());

	const [{ n: waitingOnGuest } = { n: 0 }] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(paymentAttempts)
		.where(and(eq(paymentAttempts.hotelId, hotelId), eq(paymentAttempts.status, 'open'), sql`${paymentAttempts.lastError} is null`));

	const integrity = await verifyReconChain(hotelId);
	return { settled, settledTotals, issues, waitingOnGuest, trail, integrity };
}

