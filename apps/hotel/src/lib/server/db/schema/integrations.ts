import { boolean, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, updatedAt } from './_shared';
import { hotels } from './hotels';
import { users } from './auth';

/**
 * Per-hotel integration credentials. Every secret column holds `lib/server/secrets.ts`
 * ciphertext (`v1:…`), never plaintext; the matching `*_hint` column is the masked form the
 * settings page shows (`sk_live_…a1b2`). Hotel-admin only.
 */

export const paymongoMode = pgEnum('paymongo_mode', ['test', 'live']);
export const paymongoConnectionStatus = pgEnum('paymongo_connection_status', [
	'connected',
	'webhook_error'
]);

// ---------------------------------------------------------------------------
// PayMongo (one row per hotel; no row = online payment off for that hotel)
// ---------------------------------------------------------------------------

export const paymongoSettings = pgTable('paymongo_settings', {
	hotelId: uuid('hotel_id')
		.primaryKey()
		.references(() => hotels.id, { onDelete: 'cascade' }),
	/** From the key's own prefix (`sk_test_` / `sk_live_`) — PayMongo webhooks are mode-scoped. */
	mode: paymongoMode('mode').notNull(),
	secretKeyEnc: text('secret_key_enc').notNull(),
	secretKeyHint: text('secret_key_hint').notNull(),
	/** The webhook this app registered in the hotel's PayMongo account, and its signing secret. */
	webhookId: text('webhook_id'),
	webhookUrl: text('webhook_url'),
	webhookSecretEnc: text('webhook_secret_enc'),
	status: paymongoConnectionStatus('status').notNull().default('connected'),
	lastError: text('last_error'),
	connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
	connectedByUserId: uuid('connected_by_user_id').references(() => users.id, {
		onDelete: 'set null'
	}),
	createdAt: createdAt(),
	updatedAt: updatedAt()
});

// ---------------------------------------------------------------------------
// Email (one row per hotel; no row = the platform SMTP from .env, sent as the hotel's name)
// ---------------------------------------------------------------------------

export const emailSettings = pgTable('email_settings', {
	hotelId: uuid('hotel_id')
		.primaryKey()
		.references(() => hotels.id, { onDelete: 'cascade' }),
	host: text('host').notNull(),
	port: integer('port').notNull().default(587),
	/** Implicit TLS (port 465). Otherwise STARTTLS is negotiated when the server offers it. */
	secure: boolean('secure').notNull().default(false),
	username: text('username'),
	passwordEnc: text('password_enc'),
	passwordHint: text('password_hint'),
	fromName: text('from_name'),
	fromAddress: text('from_address').notNull(),
	replyTo: text('reply_to'),
	lastTestAt: timestamp('last_test_at', { withTimezone: true }),
	lastTestOk: boolean('last_test_ok'),
	lastTestError: text('last_test_error'),
	updatedByUserId: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
	createdAt: createdAt(),
	updatedAt: updatedAt()
});

export type PaymongoSettings = typeof paymongoSettings.$inferSelect;
export type EmailSettings = typeof emailSettings.$inferSelect;

// ---------------------------------------------------------------------------
// HR connection — one per hotel (docs/HR_PLAN.md §5)
// ---------------------------------------------------------------------------

/**
 * How this hotel reaches the separate HR app: its address and the per-establishment API key Main HR
 * issued. The key is encrypted at rest like the PayMongo keys and never sent back to the browser.
 * Without a row the hotel simply has no HR picker — nothing else in the hotel depends on HR.
 */
export const hrConnections = pgTable('hr_connections', {
	hotelId: uuid('hotel_id')
		.primaryKey()
		.references(() => hotels.id, { onDelete: 'cascade' }),
	/** Origin of the HR app, e.g. `https://hr.example.com` — no path. */
	baseUrl: text('base_url').notNull(),
	apiKeyEnc: text('api_key_enc').notNull(),
	apiKeyHint: text('api_key_hint').notNull(),
	/** What HR reports for this key's establishment, for display. */
	establishmentName: text('establishment_name'),
	lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
	/** Null when the last contact worked. Never a reason to remove anyone's access. */
	lastError: text('last_error'),
	connectedByUserId: uuid('connected_by_user_id').references(() => users.id, { onDelete: 'set null' }),
	createdAt: createdAt(),
	updatedAt: updatedAt()
});

export type HrConnection = typeof hrConnections.$inferSelect;

/**
 * Display-only copy of an HR employee's name and position, keyed by `person_ref` rather than by
 * login so it outlives a removed membership (reports still name who did what). HR stays the
 * authority; this is refreshed by the link sync. Never holds pay, IDs or contact details.
 */
export const hrPersonSnapshots = pgTable(
	'hr_person_snapshots',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		personRef: text('person_ref').notNull(),
		fullName: text('full_name').notNull(),
		employeeNo: text('employee_no').notNull(),
		position: text('position'),
		department: text('department'),
		syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [uniqueIndex('hr_person_snapshots_hotel_person_idx').on(t.hotelId, t.personRef)]
);
