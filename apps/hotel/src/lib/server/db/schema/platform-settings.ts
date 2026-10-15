import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** Platform-wide key/value settings (not per hotel). Key `brand` → `{ logoUrl }`, the public landing page logo. */
export const platformSettings = pgTable('platform_settings', {
	key: text('key').primaryKey(),
	value: jsonb('value').notNull().default({}),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});
