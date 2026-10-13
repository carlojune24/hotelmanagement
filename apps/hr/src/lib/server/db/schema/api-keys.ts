import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, updatedAt } from './_shared';
import { establishments } from './org';
import { users } from './auth';

/**
 * Server-to-server keys the HR app issues so a hotel app can call `GET /api/v1/hr/…`.
 * Same convention as the hotel's `api_keys`: only the SHA-256 hash is stored, the raw key
 * is shown once. One key = one establishment.
 */
export const apiKeys = pgTable(
	'api_keys',
	{
		id: pk(),
		establishmentId: uuid('establishment_id')
			.notNull()
			.references(() => establishments.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		keyHash: text('key_hash').notNull().unique(),
		/** First ~10 chars of the raw key, for display in a key list. */
		keyPrefix: text('key_prefix').notNull(),
		scopes: text('scopes').array().notNull().default(['employees:read']),
		createdByUserId: uuid('created_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		expiresAt: timestamp('expires_at', { withTimezone: true }),
		lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
		revokedAt: timestamp('revoked_at', { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('api_keys_establishment_idx').on(t.establishmentId)]
);
