import { relations } from 'drizzle-orm';
import { bigint, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, updatedAt } from './_shared';
import { hotels } from './hotels';
import { guests } from './bookings';

/** Payment-lifecycle state only. Front-desk-specific states (checked_in, no_show, …)
 *  live on the child rows (bookings/hallBookings), not here. */
export const orderStatus = pgEnum('order_status', ['pending_payment', 'confirmed', 'cancelled']);

/**
 * One guest checkout: everything paid in a single PayMongo session. May contain
 * a room stay (`bookings`), a function hall reservation (`hallBookings`), or both.
 * Bill amounts are snapshotted at creation as the sum of each line's own already
 * fully-computed breakdown (see `pricing.ts`'s `computeFeesAndVat` — each product
 * line taxes/VATs itself independently; the order total is a snapshot sum, not a
 * re-derived combined bill).
 */
export const orders = pgTable(
	'orders',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		guestId: uuid('guest_id')
			.notNull()
			.references(() => guests.id, { onDelete: 'restrict' }),
		status: orderStatus('status').notNull().default('pending_payment'),
		currency: text('currency').notNull().default('PHP'),
		subtotalCentavos: bigint('subtotal_centavos', { mode: 'number' }).notNull(),
		feesCentavos: bigint('fees_centavos', { mode: 'number' }).notNull(),
		vatCentavos: bigint('vat_centavos', { mode: 'number' }).notNull(),
		totalCentavos: bigint('total_centavos', { mode: 'number' }).notNull(),
		/**
		 * Opaque token required (alongside the row id) on every guest-facing order
		 * URL (`/book/review/[id]?t=...`, `/book/confirmation/[id]?t=...`) — the
		 * same IDOR guard `bookings.accessToken` used to provide, moved up a level
		 * since one token now covers every line under the order.
		 */
		accessToken: text('access_token').notNull(),
		paymongoCheckoutSessionId: text('paymongo_checkout_session_id'),
		cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('orders_hotel_idx').on(t.hotelId),
		uniqueIndex('orders_access_token_idx').on(t.accessToken)
	]
);

export const orderStatusHistory = pgTable(
	'order_status_history',
	{
		id: pk(),
		orderId: uuid('order_id')
			.notNull()
			.references(() => orders.id, { onDelete: 'cascade' }),
		fromStatus: orderStatus('from_status'),
		toStatus: orderStatus('to_status').notNull(),
		note: text('note'),
		createdAt: createdAt()
	},
	(t) => [index('order_status_history_order_idx').on(t.orderId)]
);

export const ordersRelations = relations(orders, ({ one, many }) => ({
	hotel: one(hotels, { fields: [orders.hotelId], references: [hotels.id] }),
	guest: one(guests, { fields: [orders.guestId], references: [guests.id] }),
	statusHistory: many(orderStatusHistory)
}));

export const orderStatusHistoryRelations = relations(orderStatusHistory, ({ one }) => ({
	order: one(orders, { fields: [orderStatusHistory.orderId], references: [orders.id] })
}));

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderStatusHistoryRow = typeof orderStatusHistory.$inferSelect;
