import { relations } from 'drizzle-orm';
import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk } from './_shared';
import { hotels } from './hotels';
import { orders } from './orders';

/** What a logged email was. Extend as more transactional mails are added. */
export const emailType = pgEnum('email_type', ['booking_confirmation']);

/** Delivery outcome as reported by the transport. `sent` means the transport
 *  accepted it (not a guaranteed inbox delivery). */
export const emailStatus = pgEnum('email_status', ['sent', 'failed']);

/**
 * One row per transactional email the app tried to send. Gives staff a
 * "was the confirmation sent?" answer and a hook for a future resend action;
 * `sendMail` writes exactly one row per attempt. Not an outbox — the send is
 * synchronous and best-effort, this only records what happened.
 */
export const emailLog = pgTable(
	'email_log',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		/** The order this mail is about, when there is one. */
		orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
		type: emailType('type').notNull(),
		toAddress: text('to_address').notNull(),
		subject: text('subject').notNull(),
		status: emailStatus('status').notNull(),
		/** Transport message id on success. */
		messageId: text('message_id'),
		/** Error text on failure. */
		error: text('error'),
		createdAt: createdAt()
	},
	(t) => [index('email_log_hotel_idx').on(t.hotelId), index('email_log_order_idx').on(t.orderId)]
);

export const emailLogRelations = relations(emailLog, ({ one }) => ({
	hotel: one(hotels, { fields: [emailLog.hotelId], references: [hotels.id] }),
	order: one(orders, { fields: [emailLog.orderId], references: [orders.id] })
}));

export type EmailType = (typeof emailType.enumValues)[number];
export type EmailStatus = (typeof emailStatus.enumValues)[number];
export type EmailLogRow = typeof emailLog.$inferSelect;
export type NewEmailLogRow = typeof emailLog.$inferInsert;
