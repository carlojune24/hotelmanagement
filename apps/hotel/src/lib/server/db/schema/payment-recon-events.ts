import { bigint, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { pk } from './_shared';

/**
 * The money trail for payments the system had to settle itself: PayMongo took a payment but its webhook never reached
 * us, so the verifier (`paymongo/verify.ts`) found it by asking PayMongo and recorded it. One row per event, never
 * changed.
 *
 * Tamper-evident on two levels:
 *  - the database refuses UPDATE, DELETE and TRUNCATE on this table (triggers in migration 0102), and
 *  - every row carries `row_hash` = SHA-256 of its own content plus the previous row's hash (a chain per hotel, in
 *    `seq` order), so an edit made around the triggers breaks every hash after it. `finance/reconciliation-trail.ts`
 *    re-computes the chain and the Reconciliation tab shows the result.
 *
 * There are deliberately no foreign keys and no guest name or contact details: a booking or hotel can be removed
 * without touching the trail, and personal data does not live in a table that can never be edited. Names are read
 * from the booking when the page is shown.
 */
export const paymentReconEvents = pgTable(
	'payment_reconciliation_events',
	{
		id: pk(),
		hotelId: uuid('hotel_id').notNull(),
		/** 1, 2, 3 … per hotel. The chain order. */
		seq: integer('seq').notNull(),
		/** `reconciled` (PayMongo's payment was found and recorded), `reconcile_failed` (found but could not be recorded),
		 *  `amount_mismatch` (PayMongo took a different amount than we asked for), `paid_after_cancel` (paid for a
		 *  booking that had already been cancelled: a refund is owed). */
		eventType: text('event_type').notNull(),
		/** `room` (a booking order) or `dining`. */
		scope: text('scope').notNull(),
		orderId: uuid('order_id'),
		diningOrderId: uuid('dining_order_id'),
		attemptId: uuid('attempt_id'),
		/** The `payments` / `dining_payments` row this event recorded, when there is one. */
		paymentRowId: uuid('payment_row_id'),
		checkoutSessionId: text('checkout_session_id'),
		paymongoPaymentId: text('paymongo_payment_id'),
		paymentIntentId: text('payment_intent_id'),
		/** What PayMongo says it took, and what we had asked the guest to pay. */
		amountCentavos: bigint('amount_centavos', { mode: 'number' }).notNull(),
		expectedAmountCentavos: bigint('expected_amount_centavos', { mode: 'number' }),
		/** When PayMongo took the money, and when the guest started that checkout. */
		paymongoPaidAt: timestamp('paymongo_paid_at', { withTimezone: true }),
		attemptStartedAt: timestamp('attempt_started_at', { withTimezone: true }),
		/** What led to the finding: `guest_page`, `worker`, `webhook`, `hold_sweep`. */
		trigger: text('trigger').notNull(),
		/** The booking's status just before and just after. */
		orderStatusBefore: text('order_status_before'),
		orderStatusAfter: text('order_status_after'),
		/** How many times PayMongo had been asked about this checkout when it was found. */
		checks: integer('checks'),
		error: text('error'),
		details: jsonb('details'),
		occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
		/** The hash of the previous row in this hotel's chain (null for the first), and this row's own. */
		prevHash: text('prev_hash'),
		rowHash: text('row_hash').notNull()
	},
	(t) => [
		uniqueIndex('payment_recon_events_seq_uq').on(t.hotelId, t.seq),
		index('payment_recon_events_when_idx').on(t.hotelId, t.occurredAt),
		index('payment_recon_events_payment_idx').on(t.paymongoPaymentId)
	]
);

export type PaymentReconEvent = typeof paymentReconEvents.$inferSelect;
