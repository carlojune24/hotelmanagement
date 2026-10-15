import { relations } from 'drizzle-orm';
import {
	boolean,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { createdAt, pk, updatedAt } from './_shared';
import { hotels } from './hotels';
import { orders } from './orders';
import { users } from './auth';

/**
 * Customer Support live chat (guest widget <-> staff Support inbox).
 *
 * Unlike `guest_messages` / `dining_order_messages`, a conversation is not scoped to an order:
 * a visitor reaches it from any guest page, anonymously. They are identified by an httpOnly
 * visitor-token cookie (only its SHA-256 is stored), optionally linked to an order afterwards.
 *
 * Status lifecycle: `queued` (waiting for an agent) -> `open` (an agent is assigned) ->
 * `closed`. `offline_message` is a message left while nobody was available; staff reply to it
 * by email and it closes like any other conversation.
 */
export const SUPPORT_STATUSES = ['queued', 'open', 'closed', 'offline_message'] as const;
export type SupportConversationStatus = (typeof SUPPORT_STATUSES)[number];

export const SUPPORT_DIRECTIONS = ['guest', 'staff', 'system'] as const;
export type SupportMessageDirection = (typeof SUPPORT_DIRECTIONS)[number];

export const supportConversations = pgTable(
	'support_conversations',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		/** SHA-256 hex of the visitor cookie. The raw token never touches the DB. */
		visitorTokenHash: text('visitor_token_hash').notNull(),
		guestName: text('guest_name'),
		guestEmail: text('guest_email'),
		/** Set when the guest links a booking; gives staff the booking context. */
		orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
		status: text('status').$type<SupportConversationStatus>().notNull().default('queued'),
		assignedUserId: uuid('assigned_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
		closedAt: timestamp('closed_at', { withTimezone: true }),
		closedByUserId: uuid('closed_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('support_conversations_hotel_idx').on(t.hotelId),
		index('support_conversations_hotel_status_idx').on(t.hotelId, t.status),
		index('support_conversations_visitor_idx').on(t.hotelId, t.visitorTokenHash),
		index('support_conversations_assigned_idx').on(t.assignedUserId)
	]
);

export const supportMessages = pgTable(
	'support_messages',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		conversationId: uuid('conversation_id')
			.notNull()
			.references(() => supportConversations.id, { onDelete: 'cascade' }),
		direction: text('direction').$type<SupportMessageDirection>().notNull(),
		body: text('body').notNull(),
		/** The staff member who wrote a `staff` row. Null on `guest` / `system` rows. */
		authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
		/** Guest rows: set when staff have seen it. Staff rows: set when the guest's widget has. */
		readAt: timestamp('read_at', { withTimezone: true }),
		createdAt: createdAt()
	},
	(t) => [
		index('support_messages_hotel_idx').on(t.hotelId),
		index('support_messages_conversation_idx').on(t.conversationId, t.createdAt)
	]
);

/** One row per staff member who has ever opened the Support inbox. */
export const supportAgentPresence = pgTable(
	'support_agent_presence',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		/** The agent's own switch. Counts only while the heartbeat is fresh. */
		available: boolean('available').notNull().default(false),
		lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
		maxConcurrent: integer('max_concurrent').notNull().default(3),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('support_agent_presence_hotel_user_uq').on(t.hotelId, t.userId),
		index('support_agent_presence_hotel_idx').on(t.hotelId)
	]
);

/** Per-hotel FAQ chips shown first in the widget, before "Chat with a person". */
export const supportFaqs = pgTable(
	'support_faqs',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		question: text('question').notNull(),
		answer: text('answer').notNull(),
		sortOrder: integer('sort_order').notNull().default(0),
		isActive: boolean('is_active').notNull().default(true),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('support_faqs_hotel_idx').on(t.hotelId, t.sortOrder)]
);

/** Per-hotel canned replies for the staff inbox ("/" picker). Placeholders ({guest}, {agent}, {hotel}, {checkin}, {checkout}) are filled in client-side. */
export const supportCannedReplies = pgTable(
	'support_canned_replies',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		body: text('body').notNull(),
		sortOrder: integer('sort_order').notNull().default(0),
		isActive: boolean('is_active').notNull().default(true),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('support_canned_replies_hotel_idx').on(t.hotelId, t.sortOrder)]
);

export const supportConversationsRelations = relations(supportConversations, ({ one, many }) => ({
	hotel: one(hotels, { fields: [supportConversations.hotelId], references: [hotels.id] }),
	order: one(orders, { fields: [supportConversations.orderId], references: [orders.id] }),
	assignedUser: one(users, {
		fields: [supportConversations.assignedUserId],
		references: [users.id]
	}),
	messages: many(supportMessages)
}));

export const supportMessagesRelations = relations(supportMessages, ({ one }) => ({
	conversation: one(supportConversations, {
		fields: [supportMessages.conversationId],
		references: [supportConversations.id]
	}),
	author: one(users, { fields: [supportMessages.authorUserId], references: [users.id] })
}));

export type SupportConversationRow = typeof supportConversations.$inferSelect;
export type SupportMessageRow = typeof supportMessages.$inferSelect;
export type SupportAgentPresenceRow = typeof supportAgentPresence.$inferSelect;
export type SupportFaqRow = typeof supportFaqs.$inferSelect;
export type SupportCannedReplyRow = typeof supportCannedReplies.$inferSelect;
