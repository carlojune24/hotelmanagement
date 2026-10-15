import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, boolean } from 'drizzle-orm/pg-core';
import { pk, updatedAt } from './_shared';
import { hotels } from './hotels';
import { orders } from './orders';
import { diningOrders } from './dining';

/**
 * A mirror of what PayMongo itself says happened to the hotel's money: payments in (with PayMongo's fee and the
 * net it keeps for the hotel), refunds out, and payouts to the bank. Filled by `finance/paymongo-sync.ts` from
 * PayMongo's list APIs, so it also contains money our app never saw (a payment taken on the dashboard, a fee, a
 * payout). Display and reconciliation only: it never posts a cash movement, the books stay cash-basis.
 * Amounts are integer centavos, always positive: `direction` says which way the money moved.
 */
export const paymongoLedger = pgTable(
	'paymongo_ledger',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		/** PayMongo's own id: `pay_…`, `ref_…` or `po_…`. */
		paymongoId: text('paymongo_id').notNull(),
		/** `payment` | `refund` | `payout` */
		kind: text('kind').notNull(),
		/** `in` = money into PayMongo (a payment), `out` = money leaving (a refund, or a payout to the bank). */
		direction: text('direction').notNull(),
		/** PayMongo's status as given (paid, failed, pending, succeeded, in_transit, deposited, …). */
		status: text('status').notNull(),
		grossCentavos: integer('gross_centavos').notNull(),
		feeCentavos: integer('fee_centavos').notNull().default(0),
		netCentavos: integer('net_centavos').notNull(),
		currency: text('currency').notNull().default('PHP'),
		/** When it happened: paid_at for a payment, created_at for a refund / payout. */
		occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
		/** Payments: when the funds can be paid out; and when PayMongo schedules the credit. */
		availableAt: timestamp('available_at', { withTimezone: true }),
		creditedAt: timestamp('credited_at', { withTimezone: true }),
		/** The payout (`po_…`) a payment was paid out in; null until it joins one. */
		payoutId: text('payout_id'),
		balanceTransactionId: text('balance_transaction_id'),
		/** How the guest paid: gcash, card, qrph, paymaya… */
		sourceType: text('source_type'),
		reference: text('reference'),
		description: text('description'),
		/** Refunds: the payment being refunded. */
		paymentId: text('payment_id'),
		/** The booking / dining order this money belongs to, when our own records can say. */
		orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
		diningOrderId: uuid('dining_order_id').references(() => diningOrders.id, { onDelete: 'set null' }),
		/** Payouts: where it went. The full account number is never kept, only its last 4 digits. */
		bankName: text('bank_name'),
		accountLast4: text('account_last4'),
		/** PayMongo's record as received (the customer's billing block is dropped before saving). */
		raw: jsonb('raw'),
		syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		uniqueIndex('paymongo_ledger_hotel_pm_uq').on(t.hotelId, t.paymongoId),
		index('paymongo_ledger_hotel_occurred_idx').on(t.hotelId, t.occurredAt),
		index('paymongo_ledger_hotel_kind_idx').on(t.hotelId, t.kind, t.status),
		index('paymongo_ledger_payment_idx').on(t.hotelId, t.paymentId)
	]
);

/** One row per hotel: how fresh the mirror is, and what the wallet lookup found. */
export const paymongoSyncState = pgTable('paymongo_sync_state', {
	hotelId: uuid('hotel_id')
		.primaryKey()
		.references(() => hotels.id, { onDelete: 'cascade' }),
	lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
	/** Set once the full history has been pulled; afterwards only a recent window is re-read. */
	backfilledAt: timestamp('backfilled_at', { withTimezone: true }),
	lastError: text('last_error'),
	/** True when PayMongo returned a wallet for this account (Money Movement). */
	walletSupported: boolean('wallet_supported').notNull().default(false),
	/** The wallet as PayMongo returned it, for the balance card. */
	walletBalance: jsonb('wallet_balance'),
	updatedAt: updatedAt()
});

export type PaymongoLedgerRow = typeof paymongoLedger.$inferSelect;
export type PaymongoSyncStateRow = typeof paymongoSyncState.$inferSelect;
