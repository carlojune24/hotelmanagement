import { relations } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pk } from './_shared';
import { hotels } from './hotels';

/**
 * One row per unexpected (5xx) server error, written best-effort from
 * `hooks.server.ts`'s `handleError` — the `ref` shown on the error page is the
 * lookup key into this table. A logging failure never turns into a second error;
 * the console line `handleError` already prints stays the fallback. Rows older
 * than the retention window are swept by the `error_log_retention` job.
 */
export const errorLog = pgTable(
	'error_log',
	{
		id: pk(),
		/** Short reference shown to the visitor, e.g. "01B32ACA". */
		ref: text('ref').notNull().unique(),
		occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
		method: text('method').notNull(),
		/** `event.url.pathname` only — never the query string, which can carry a guest's
		 *  booking-manage token (`?t=`) or other sensitive values. */
		path: text('path').notNull(),
		routeId: text('route_id'),
		userId: uuid('user_id'),
		/** No FK cascade-delete — a hotel is archived, not hard-deleted, but this stays
		 *  a soft reference (`set null`) rather than assuming that never changes. */
		hotelId: uuid('hotel_id').references(() => hotels.id, { onDelete: 'set null' }),
		message: text('message').notNull(),
		/** Capped at insert time — see `MAX_STACK_LENGTH` in `lib/server/error-log.ts`. */
		stack: text('stack')
	},
	(t) => [
		index('error_log_occurred_idx').on(t.occurredAt),
		index('error_log_hotel_idx').on(t.hotelId),
		index('error_log_route_message_idx').on(t.routeId, t.message)
	]
);

export const errorLogRelations = relations(errorLog, ({ one }) => ({
	hotel: one(hotels, { fields: [errorLog.hotelId], references: [hotels.id] })
}));

export type ErrorLogRow = typeof errorLog.$inferSelect;
export type NewErrorLogRow = typeof errorLog.$inferInsert;
