import { boolean, index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, updatedAt } from './_shared';

export const userStatus = pgEnum('user_status', ['active', 'disabled']);

/** HR-app logins. Deliberately separate from the hotel app's `users` — see docs/HR_PLAN.md §2. */
export const users = pgTable(
	'users',
	{
		id: pk(),
		email: text('email').notNull().unique(),
		/** Argon2id hash. */
		passwordHash: text('password_hash'),
		name: text('name').notNull(),
		status: userStatus('status').notNull().default('active'),
		/** Break-glass operator flag (seeded account); not a business role. */
		isSystemAdmin: boolean('is_system_admin').notNull().default(false),
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

/**
 * A sign-in waiting for its emailed code: the password was right, the session does not exist yet.
 * `id` is the SHA-256 of the opaque token in the short-lived `mm_hr_otp` cookie; the 6-digit code is
 * stored only as a hash. Deleted when the code is accepted, when it expires, or when a new sign-in starts.
 */
export const loginChallenges = pgTable(
	'login_challenges',
	{
		id: text('id').primaryKey(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		codeHash: text('code_hash').notNull(),
		/** Where to send the user after sign-in (already checked by `safeNext`). */
		next: text('next'),
		/** Wrong codes entered for the current code; at the limit the challenge is dead. */
		attempts: integer('attempts').notNull().default(0),
		/** Codes emailed for this challenge, the first one included. */
		sends: integer('sends').notNull().default(1),
		lastSentAt: timestamp('last_sent_at', { withTimezone: true }).notNull().defaultNow(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		createdAt: createdAt()
	},
	(t) => [index('login_challenges_user_idx').on(t.userId)]
);

export type User = typeof users.$inferSelect;
