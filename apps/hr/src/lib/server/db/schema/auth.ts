import { boolean, index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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

export type User = typeof users.$inferSelect;
