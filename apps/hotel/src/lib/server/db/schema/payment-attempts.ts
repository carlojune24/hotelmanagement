import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk } from './_shared';
import { hotels } from './hotels';
import { orders } from './orders';
import { diningOrders } from './dining';

/**
 * One row for every PayMongo checkout session we ever create, kept for good. It is what lets us check a payment
 * with PayMongo directly instead of waiting for its webhook (`paymongo/verify.ts`), and what ties a guest's
 * payment to our books: a booking that was paid but never confirmed (the webhook could not reach us) is found
 * here, and the PayMongo payment ID (`pay_…`) is stored beside the order it belongs to, so refunds and Finance
 * reconciliation trace it.
 *
 * `status`: `open` = the guest may still pay (keep checking), `paid` = PayMongo says it was paid and we recorded
 * it, `expired` = the session can no longer be paid (expired, superseded by a newer one, or the order was cancelled).
 */
export const paymentAttempts = pgTable(
	'payment_attempts',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		/** `room` = a room / hall booking order, `dining` = a restaurant order. */
		scope: text('scope').notNull(),
		orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
		diningOrderId: uuid('dining_order_id').references(() => diningOrders.id, { onDelete: 'set null' }),
		/** PayMongo's `cs_…`. */
		checkoutSessionId: text('checkout_session_id').notNull(),
		amountCentavos: integer('amount_centavos').notNull(),
		status: text('status').notNull().default('open'),
		/** Filled when PayMongo reports the payment: `pay_…` and its `pi_…`. */
		paymongoPaymentId: text('paymongo_payment_id'),
		paymentIntentId: text('payment_intent_id'),
		paidAt: timestamp('paid_at', { withTimezone: true }),
		/** How many times the worker has asked PayMongo, and when it asks next. */
		checks: integer('checks').notNull().default(0),
		lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
		nextCheckAt: timestamp('next_check_at', { withTimezone: true }).notNull().defaultNow(),
		lastSessionStatus: text('last_session_status'),
		lastError: text('last_error'),
		/** The guest emails already sent for this attempt, so each goes out once. */
		trackingEmailAt: timestamp('tracking_email_at', { withTimezone: true }),
		delayedEmailAt: timestamp('delayed_email_at', { withTimezone: true }),
		createdAt: createdAt(),
		resolvedAt: timestamp('resolved_at', { withTimezone: true })
	},
	(t) => [
		uniqueIndex('payment_attempts_session_uq').on(t.hotelId, t.checkoutSessionId),
		index('payment_attempts_due_idx').on(t.status, t.nextCheckAt),
		index('payment_attempts_order_idx').on(t.orderId),
		index('payment_attempts_dining_idx').on(t.diningOrderId),
		index('payment_attempts_payment_idx').on(t.paymongoPaymentId)
	]
);

export type PaymentAttemptRow = typeof paymentAttempts.$inferSelect;

/** The short code a guest or the front desk can quote for an attempt: `PC-1A2B3C4D`. */
export const attemptCode = (id: string) => `PC-${id.slice(0, 8).toUpperCase()}`;
