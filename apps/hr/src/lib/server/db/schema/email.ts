import { boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, updatedAt } from './_shared';
import { users } from './auth';
import { organizations } from './org';

/**
 * The company's outgoing mailbox (Settings → Sign-in & email) — Main HR only, one row per company.
 * The password is AES-256-GCM encrypted under `APP_ENCRYPTION_KEY` and never sent back to the browser.
 */
export const emailSettings = pgTable('email_settings', {
	id: pk(),
	organizationId: uuid('organization_id')
		.notNull()
		.unique()
		.references(() => organizations.id, { onDelete: 'cascade' }),
	host: text('host').notNull(),
	port: integer('port').notNull().default(587),
	/** True for implicit TLS (port 465); false uses STARTTLS when the server offers it. */
	secure: boolean('secure').notNull().default(false),
	username: text('username'),
	passwordEnc: text('password_enc'),
	/** A masked hint (`…a1b2`) so the page can show a password is saved. */
	passwordHint: text('password_hint'),
	fromName: text('from_name'),
	fromAddress: text('from_address').notNull(),
	replyTo: text('reply_to'),
	/** Ask for an emailed 6-digit code after the password. Only takes effect once a test email has succeeded. */
	signinCodeRequired: boolean('signin_code_required').notNull().default(false),
	lastTestAt: timestamp('last_test_at', { withTimezone: true }),
	lastTestOk: boolean('last_test_ok'),
	lastTestError: text('last_test_error'),
	updatedByUserId: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
	createdAt: createdAt(),
	updatedAt: updatedAt()
});
