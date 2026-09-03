import { relations } from 'drizzle-orm';
import { boolean, index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, updatedAt } from './_shared';
import { memberships } from './hotels';

export const userStatus = pgEnum('user_status', ['active', 'disabled']);

export const users = pgTable(
	'users',
	{
		id: pk(),
		email: text('email').notNull().unique(),
		emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
		/** Argon2id hash. Null only for an invited user who has not set a password yet. */
		passwordHash: text('password_hash'),
		name: text('name').notNull(),
		isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
		status: userStatus('status').notNull().default('active'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('users_email_idx').on(t.email)]
);

export const sessions = pgTable('sessions', {
	/** SHA-256 of the opaque token the client holds. The raw token is never stored. */
	id: text('id').primaryKey(),
	userId: uuid('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	createdAt: createdAt()
});

export const inviteStatus = pgEnum('invite_status', ['pending', 'accepted', 'revoked', 'expired']);

/** Invitation to join a hotel with a given role (hotel_id + role set), or to
 *  become a platform admin (both null). */
export const invites = pgTable(
	'invites',
	{
		id: pk(),
		email: text('email').notNull(),
		tokenHash: text('token_hash').notNull().unique(),
		hotelId: uuid('hotel_id'),
		role: text('role'),
		invitedByUserId: uuid('invited_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		status: inviteStatus('status').notNull().default('pending'),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		acceptedAt: timestamp('accepted_at', { withTimezone: true }),
		createdAt: createdAt()
	},
	(t) => [index('invites_email_idx').on(t.email)]
);

export const usersRelations = relations(users, ({ many }) => ({
	sessions: many(sessions),
	memberships: many(memberships)
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
	user: one(users, { fields: [sessions.userId], references: [users.id] })
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Invite = typeof invites.$inferSelect;
