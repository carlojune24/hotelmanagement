import { relations } from 'drizzle-orm';
import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk } from './_shared';
import { hotels } from './hotels';
import { orders } from './orders';
import { bookings, hallBookings } from './bookings';
import { users } from './auth';

/** Who wrote the row. A `guest` row comes from `/book/manage`'s tokenized page (no
 *  login); a `staff` row comes from an authenticated reply. */
export const guestMessageDirection = pgEnum('guest_message_direction', ['guest', 'staff']);

/** A plain question/comment, or a guest's request to cancel a specific line — the
 *  latter never cancels anything by itself, it only asks staff to. */
export const guestMessageKind = pgEnum('guest_message_kind', ['message', 'cancellation_request']);

/** Lifecycle of a `cancellation_request` row only — null on every other row.
 *  `actioned` is set automatically the moment the referenced line is actually
 *  cancelled (by any path, not just this request); `declined` is a deliberate
 *  staff decision with a required note. */
export const guestMessageStatus = pgEnum('guest_message_status', ['open', 'actioned', 'declined']);

/**
 * One row per guest↔staff message under an order — the in-app foundation the
 * planned Mailgun two-way email conversation (docs/TODO.md) is meant to grow
 * into, not a one-off. Deliberately minimal for now: no inbound-email capture,
 * no attachments, no guest accounts — a guest reaches this only via the
 * tokenized `/book/manage` link, the same guard `orders.accessToken` already
 * provides elsewhere.
 *
 * `bookingId`/`hallBookingId` name which line a `cancellation_request` is
 * about; a plain `message` may leave both null (a general question about the
 * whole order). At most one of the two is ever set — enforced in
 * `guest-messages.ts`, not by a DB constraint.
 */
export const guestMessages = pgTable(
	'guest_messages',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		orderId: uuid('order_id')
			.notNull()
			.references(() => orders.id, { onDelete: 'cascade' }),
		bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'cascade' }),
		hallBookingId: uuid('hall_booking_id').references(() => hallBookings.id, {
			onDelete: 'cascade'
		}),
		direction: guestMessageDirection('direction').notNull(),
		kind: guestMessageKind('kind').notNull().default('message'),
		/** Only meaningful when `kind = 'cancellation_request'`. */
		status: guestMessageStatus('status'),
		body: text('body').notNull(),
		resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		resolvedAt: timestamp('resolved_at', { withTimezone: true }),
		/** Set once any staff member has viewed the thread past this row — drives the
		 *  hotel-wide Messages list's unread state. Only meaningful on a `guest` row. */
		readByStaffAt: timestamp('read_by_staff_at', { withTimezone: true }),
		/** The staff member who wrote a `staff` row. Null on a `guest` row. */
		createdByUserId: uuid('created_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		createdAt: createdAt()
	},
	(t) => [
		index('guest_messages_hotel_idx').on(t.hotelId),
		index('guest_messages_order_idx').on(t.orderId),
		index('guest_messages_booking_idx').on(t.bookingId),
		index('guest_messages_hall_booking_idx').on(t.hallBookingId)
	]
);

export const guestMessagesRelations = relations(guestMessages, ({ one }) => ({
	hotel: one(hotels, { fields: [guestMessages.hotelId], references: [hotels.id] }),
	order: one(orders, { fields: [guestMessages.orderId], references: [orders.id] }),
	booking: one(bookings, { fields: [guestMessages.bookingId], references: [bookings.id] }),
	hallBooking: one(hallBookings, {
		fields: [guestMessages.hallBookingId],
		references: [hallBookings.id]
	}),
	resolvedBy: one(users, { fields: [guestMessages.resolvedByUserId], references: [users.id] }),
	createdBy: one(users, { fields: [guestMessages.createdByUserId], references: [users.id] })
}));

export type GuestMessageDirection = (typeof guestMessageDirection.enumValues)[number];
export type GuestMessageKind = (typeof guestMessageKind.enumValues)[number];
export type GuestMessageStatus = (typeof guestMessageStatus.enumValues)[number];
export type GuestMessageRow = typeof guestMessages.$inferSelect;
export type NewGuestMessageRow = typeof guestMessages.$inferInsert;
