import { createHash } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index';
import { paymentReconEvents, type PaymentReconEvent } from '../db/schema/index';

/**
 * Writes and checks the money trail in `payment_reconciliation_events` (see the schema file for what it is for).
 *
 * Every row's `row_hash` is SHA-256 over the row's content plus the previous row's hash, one chain per hotel in
 * `seq` order. Appending takes a per-hotel advisory lock so two checks finishing at the same moment cannot both
 * claim the same `seq` or fork the chain. Relative imports only: scripts can call this outside the app.
 */

export type ReconEventType = 'reconciled' | 'reconcile_failed' | 'amount_mismatch' | 'paid_after_cancel';
export type ReconTrigger = 'guest_page' | 'worker' | 'webhook' | 'hold_sweep' | 'backfill';

export interface ReconEventInput {
	hotelId: string;
	eventType: ReconEventType;
	scope: 'room' | 'dining';
	orderId?: string | null;
	diningOrderId?: string | null;
	attemptId?: string | null;
	paymentRowId?: string | null;
	checkoutSessionId?: string | null;
	paymongoPaymentId?: string | null;
	paymentIntentId?: string | null;
	amountCentavos: number;
	expectedAmountCentavos?: number | null;
	paymongoPaidAt?: Date | null;
	attemptStartedAt?: Date | null;
	trigger: ReconTrigger;
	orderStatusBefore?: string | null;
	orderStatusAfter?: string | null;
	checks?: number | null;
	error?: string | null;
	details?: Record<string, unknown> | null;
	occurredAt?: Date;
}

/** JSON with object keys sorted, so a value hashes the same however the database hands its keys back. */
function stable(v: unknown): string {
	if (v === null || v === undefined) return 'null';
	if (v instanceof Date) return JSON.stringify(v.toISOString());
	if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
	if (typeof v === 'object') {
		const o = v as Record<string, unknown>;
		return `{${Object.keys(o)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
			.join(',')}}`;
	}
	return JSON.stringify(v);
}

type Hashed = Omit<PaymentReconEvent, 'id' | 'rowHash'>;

/** The fields a row's hash covers, in a fixed order. Anything added to the table later must be added here too. */
export function hashEvent(e: Hashed): string {
	const content = stable([
		e.hotelId,
		e.seq,
		e.eventType,
		e.scope,
		e.orderId,
		e.diningOrderId,
		e.attemptId,
		e.paymentRowId,
		e.checkoutSessionId,
		e.paymongoPaymentId,
		e.paymentIntentId,
		e.amountCentavos,
		e.expectedAmountCentavos,
		e.paymongoPaidAt,
		e.attemptStartedAt,
		e.trigger,
		e.orderStatusBefore,
		e.orderStatusAfter,
		e.checks,
		e.error,
		e.details,
		e.occurredAt,
		e.prevHash
	]);
	return createHash('sha256').update(content).digest('hex');
}

/** Adds one event to the hotel's chain. Throws if it cannot (the caller decides whether that may fail a payment). */
export async function appendReconEvent(input: ReconEventInput): Promise<PaymentReconEvent> {
	return db.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'recon-trail:' + input.hotelId}))`);
		const [last] = await tx
			.select({ seq: paymentReconEvents.seq, rowHash: paymentReconEvents.rowHash })
			.from(paymentReconEvents)
			.where(eq(paymentReconEvents.hotelId, input.hotelId))
			.orderBy(sql`${paymentReconEvents.seq} desc`)
			.limit(1);
		const base: Hashed = {
			hotelId: input.hotelId,
			seq: (last?.seq ?? 0) + 1,
			eventType: input.eventType,
			scope: input.scope,
			orderId: input.orderId ?? null,
			diningOrderId: input.diningOrderId ?? null,
			attemptId: input.attemptId ?? null,
			paymentRowId: input.paymentRowId ?? null,
			checkoutSessionId: input.checkoutSessionId ?? null,
			paymongoPaymentId: input.paymongoPaymentId ?? null,
			paymentIntentId: input.paymentIntentId ?? null,
			amountCentavos: input.amountCentavos,
			expectedAmountCentavos: input.expectedAmountCentavos ?? null,
			paymongoPaidAt: input.paymongoPaidAt ?? null,
			attemptStartedAt: input.attemptStartedAt ?? null,
			trigger: input.trigger,
			orderStatusBefore: input.orderStatusBefore ?? null,
			orderStatusAfter: input.orderStatusAfter ?? null,
			checks: input.checks ?? null,
			error: input.error ? input.error.slice(0, 500) : null,
			details: input.details ?? null,
			// Whole milliseconds, so the stored value and the hashed value are the same instant.
			occurredAt: new Date(input.occurredAt?.getTime() ?? Date.now()),
			prevHash: last?.rowHash ?? null
		};
		const [row] = await tx
			.insert(paymentReconEvents)
			.values({ ...base, rowHash: hashEvent(base) })
			.returning();
		return row!;
	});
}

export interface ChainCheck {
	ok: boolean;
	/** Rows read and hashed. */
	events: number;
	/** The newest row's hash: note it down (or print it) to prove later that nothing before it changed. */
	headHash: string | null;
	headSeq: number | null;
	/** What went wrong, first problem only. */
	problem: { seq: number; reason: 'hash_mismatch' | 'broken_link' | 'gap' } | null;
	checkedAt: Date;
}

/** Re-computes the whole chain for a hotel. Reads only. */
export async function verifyReconChain(hotelId: string): Promise<ChainCheck> {
	const rows = await db.select().from(paymentReconEvents).where(eq(paymentReconEvents.hotelId, hotelId)).orderBy(asc(paymentReconEvents.seq));
	let prev: PaymentReconEvent | null = null;
	let problem: ChainCheck['problem'] = null;
	for (const r of rows) {
		const { id: _id, rowHash, ...rest } = r;
		if (!problem) {
			if (r.seq !== (prev?.seq ?? 0) + 1) problem = { seq: r.seq, reason: 'gap' };
			else if ((r.prevHash ?? null) !== (prev?.rowHash ?? null)) problem = { seq: r.seq, reason: 'broken_link' };
			else if (hashEvent(rest) !== rowHash) problem = { seq: r.seq, reason: 'hash_mismatch' };
		}
		prev = r;
	}
	return { ok: problem === null, events: rows.length, headHash: prev?.rowHash ?? null, headSeq: prev?.seq ?? null, problem, checkedAt: new Date() };
}
