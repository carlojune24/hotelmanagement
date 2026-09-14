import { relations } from 'drizzle-orm';
import { boolean, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { updatedAt } from './_shared';
import { hotels } from './hotels';
import { users } from './auth';

/**
 * Per-hotel on/off switch for a scheduled background job (see
 * `lib/server/jobs/`). One row per `(hotel_id, job_key)`; a missing row means
 * "use the job's own default" (see `lib/server/jobs/toggles.ts`), so a fresh hotel
 * doesn't need a seeding step — it just inherits sensible defaults until staff
 * changes one.
 */
export const jobToggles = pgTable(
	'job_toggles',
	{
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		/** e.g. `hold_sweep`, `recurring_expenses`, `no_show_autoflag` — see `jobs/toggles.ts`'s
		 *  `JOB_KEYS` for the closed, additive list. */
		jobKey: text('job_key').notNull(),
		enabled: boolean('enabled').notNull(),
		updatedAt: updatedAt(),
		updatedByUserId: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'set null' })
	},
	(t) => [primaryKey({ columns: [t.hotelId, t.jobKey] })]
);

export const jobTogglesRelations = relations(jobToggles, ({ one }) => ({
	hotel: one(hotels, { fields: [jobToggles.hotelId], references: [hotels.id] })
}));

export type JobToggle = typeof jobToggles.$inferSelect;
