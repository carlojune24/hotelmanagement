import { relations } from 'drizzle-orm';
import { index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk } from './_shared';
import { hotels } from './hotels';
import { bookings } from './bookings';
import { users } from './auth';

export const reviewStatus = pgEnum('review_status', ['pending', 'approved', 'rejected']);

/**
 * A guest review tied to one real room-stay booking — never fabricated, never
 * accepted without a completed stay behind it. Verified via the booking's own
 * order access token (see `book/leave-review/[bookingId]`), not a new auth
 * system. One review per booking (unique on `bookingId`): a guest doesn't get
 * to resubmit after rejection, and a completed stay carries at most one review.
 * `rating` additionally gets a hand-written `CHECK (rating BETWEEN 1 AND 5)` in
 * the migration — drizzle-kit doesn't emit range checks from a plain `integer()`.
 */
export const reviews = pgTable(
	'reviews',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		bookingId: uuid('booking_id')
			.notNull()
			.references(() => bookings.id, { onDelete: 'cascade' }),
		rating: integer('rating').notNull(),
		comment: text('comment').notNull(),
		/** Guest-chosen display form, e.g. "Carlo C." — not necessarily the full legal name on file. */
		guestDisplayName: text('guest_display_name').notNull(),
		status: reviewStatus('status').notNull().default('pending'),
		moderationNote: text('moderation_note'),
		submittedAt: createdAt(),
		moderatedAt: timestamp('moderated_at', { withTimezone: true }),
		moderatedBy: uuid('moderated_by').references(() => users.id, { onDelete: 'set null' })
	},
	(t) => [
		index('reviews_hotel_idx').on(t.hotelId),
		index('reviews_hotel_status_idx').on(t.hotelId, t.status),
		uniqueIndex('reviews_booking_idx').on(t.bookingId)
	]
);

export const reviewsRelations = relations(reviews, ({ one }) => ({
	hotel: one(hotels, { fields: [reviews.hotelId], references: [hotels.id] }),
	booking: one(bookings, { fields: [reviews.bookingId], references: [bookings.id] }),
	moderator: one(users, { fields: [reviews.moderatedBy], references: [users.id] })
}));

export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;
