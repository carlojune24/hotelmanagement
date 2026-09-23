import { relations, sql } from 'drizzle-orm';
import { bigint, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, updatedAt } from './_shared';
import { hotels } from './hotels';
import { bookings } from './bookings';
import { users } from './auth';

/**
 * Philippine BIR Senior Citizen (RA 9994) / PWD (RA 10754) discount — flagged by staff at
 * check-in (see `lib/server/sc-pwd-discount.ts`). A qualifying sale isn't just a 20% discount:
 * the whole base room charge becomes VAT-exempt, and the discount itself is computed on the
 * VAT-exclusive amount. One row per applied claim; `reversedAt` marks an undo (correction path
 * is reverse-then-reapply, never an in-place edit) — at most one ACTIVE claim per booking.
 */
export const scPwdClaimantType = pgEnum('sc_pwd_claimant_type', ['senior_citizen', 'pwd']);

export const scPwdDiscounts = pgTable(
	'sc_pwd_discounts',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		bookingId: uuid('booking_id')
			.notNull()
			.references(() => bookings.id, { onDelete: 'cascade' }),
		claimantType: scPwdClaimantType('claimant_type').notNull(),
		claimantName: text('claimant_name').notNull(),
		/** OSCA ID (senior) or PWD ID number — required on the printed Invoice/OR for a
		 *  qualifying sale to be valid. */
		idNumber: text('id_number').notNull(),
		/** Snapshot of `bir_settings.sc_pwd_discount_bps` actually used, so a later settings
		 *  change never rewrites a past claim's own figures. */
		discountBps: integer('discount_bps').notNull(),
		/** The base charge's pre-VAT amount the discount was computed on. */
		baseAmountCentavos: bigint('base_amount_centavos', { mode: 'number' }).notNull(),
		/** VAT that would have applied — zeroed out because the sale is now exempt. */
		vatRemovedCentavos: bigint('vat_removed_centavos', { mode: 'number' }).notNull(),
		discountCentavos: bigint('discount_centavos', { mode: 'number' }).notNull(),
		/** The negative `folio_charges` row this claim posted — plain uuid, no FK, same
		 *  posture as `payments.folio_id`. */
		folioChargeId: uuid('folio_charge_id'),
		appliedByUserId: uuid('applied_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
		reversedByUserId: uuid('reversed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		reversedAt: timestamp('reversed_at', { withTimezone: true }),
		reversedReason: text('reversed_reason'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('sc_pwd_discounts_hotel_idx').on(t.hotelId, t.appliedAt),
		index('sc_pwd_discounts_booking_idx').on(t.bookingId),
		uniqueIndex('sc_pwd_discounts_one_active_per_booking_idx')
			.on(t.bookingId)
			.where(sql`reversed_at is null`)
	]
);

export const scPwdDiscountsRelations = relations(scPwdDiscounts, ({ one }) => ({
	hotel: one(hotels, { fields: [scPwdDiscounts.hotelId], references: [hotels.id] }),
	booking: one(bookings, { fields: [scPwdDiscounts.bookingId], references: [bookings.id] })
}));

export type ScPwdDiscount = typeof scPwdDiscounts.$inferSelect;
export type NewScPwdDiscount = typeof scPwdDiscounts.$inferInsert;
