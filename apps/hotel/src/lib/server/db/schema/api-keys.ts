import { relations } from 'drizzle-orm';
import { index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, updatedAt } from './_shared';
import { hotels } from './hotels';
import { users } from './auth';

/**
 * Service credentials for the read-only external Finance API
 * (`/api/v1/finance/*`) — separate from session/RBAC auth, which is
 * cookie-based and not usable by an external consolidator. Single-hotel scoped
 * for v1; `api_key_hotel_scopes` stays multi-row-capable so a future multi-hotel
 * key needs no schema change.
 */
export const apiKeys = pgTable(
	'api_keys',
	{
		id: pk(),
		name: text('name').notNull(),
		/** SHA-256 hex of the raw key — same convention as `sessions.id`. The raw key
		 *  is shown once at creation and never stored or retrievable again. */
		keyHash: text('key_hash').notNull().unique(),
		/** First ~10 chars of the raw key in cleartext, for display in a key list
		 *  (`mmhk_live_7f3a2b…`) — GitHub-PAT / Stripe convention. */
		keyPrefix: text('key_prefix').notNull(),
		/** Fixed to `['finance:read']` for v1; left extensible for finer-grained scope
		 *  later without a migration. */
		scopes: text('scopes').array().notNull().default(['finance:read']),
		createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		expiresAt: timestamp('expires_at', { withTimezone: true }),
		lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
		revokedAt: timestamp('revoked_at', { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('api_keys_key_hash_idx').on(t.keyHash)]
);

export const apiKeyHotelScopes = pgTable(
	'api_key_hotel_scopes',
	{
		apiKeyId: uuid('api_key_id')
			.notNull()
			.references(() => apiKeys.id, { onDelete: 'cascade' }),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' })
	},
	(t) => [
		primaryKey({ columns: [t.apiKeyId, t.hotelId] }),
		index('api_key_hotel_scopes_hotel_idx').on(t.hotelId)
	]
);

export const apiKeysRelations = relations(apiKeys, ({ many }) => ({
	hotelScopes: many(apiKeyHotelScopes)
}));

export const apiKeyHotelScopesRelations = relations(apiKeyHotelScopes, ({ one }) => ({
	apiKey: one(apiKeys, { fields: [apiKeyHotelScopes.apiKeyId], references: [apiKeys.id] }),
	hotel: one(hotels, { fields: [apiKeyHotelScopes.hotelId], references: [hotels.id] })
}));

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
