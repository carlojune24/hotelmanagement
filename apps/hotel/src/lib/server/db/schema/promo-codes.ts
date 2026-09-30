import { relations } from 'drizzle-orm';
import { bigint, boolean, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, pk, updatedAt } from './_shared';
import { hotels } from './hotels';
import { bookings } from './bookings';
import { users } from './auth';

/** A real, guest-facing coupon — unlike the old (removed) `rate_plans.promo_code` model,
 *  this reduces the price of whatever the guest already booked instead of only revealing a
 *  separate, pre-discounted rate plan. `code` is always stored upper-trimmed (see
 *  `lib/server/promo-codes.ts`'s `normalizePromoCode`) so uniqueness and matching are a plain
 *  equality check, no functional index needed. */
export const promoDiscountType = pgEnum('promo_discount_type', ['percentage', 'fixed_amount']);

export const promoCodes = pgTable(
	'promo_codes',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		code: text('code').notNull(),
		description: text('description'),
		discountType: promoDiscountType('discount_type').notNull(),
		/** Basis points off the room total — set only when `discountType = 'percentage'`. */
		discountBps: integer('discount_bps'),
		/** Flat amount off, in centavos — set only when `discountType = 'fixed_amount'`; capped
		 *  to what's actually owed at redemption time so it can never push a booking negative. */
		discountAmountCentavos: bigint('discount_amount_centavos', { mode: 'number' }),
		/** Redemption window — both null means "no time limit." Checked against the current
		 *  time at redemption, not the stay dates, so a code can run as a short-lived sale. */
		validFrom: timestamp('valid_from', { withTimezone: true }),
		validUntil: timestamp('valid_until', { withTimezone: true }),
		isActive: boolean('is_active').notNull().default(true),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: deletedAt()
	},
	(t) => [
		index('promo_codes_hotel_idx').on(t.hotelId),
		uniqueIndex('promo_codes_hotel_code_idx').on(t.hotelId, t.code)
	]
);

/**
 * One row per room booking a promo code actually discounted — the audit trail + the link to
 * the negative `folio_charges` line that made the discount real money, not just a display
 * number. A multi-room order redeeming one code gets one row per room booking, each with its
 * own pro-rata share (see `lib/server/promo-codes.ts`'s `applyPromoCodeToOrder`).
 */
export const promoRedemptions = pgTable(
	'promo_redemptions',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		promoCodeId: uuid('promo_code_id')
			.notNull()
			.references(() => promoCodes.id, { onDelete: 'restrict' }),
		bookingId: uuid('booking_id')
			.notNull()
			.references(() => bookings.id, { onDelete: 'cascade' }),
		/** Snapshot of the code text as redeemed — survives the parent `promo_codes` row being
		 *  renamed/edited later, same snapshot posture `bookings.*Centavos` already uses. */
		code: text('code').notNull(),
		discountCentavos: bigint('discount_centavos', { mode: 'number' }).notNull(),
		/** Null for a normal checkout redemption — that flow bakes the discount straight into
		 *  the booking's own `totalCentavos` (so it actually reduces what's charged online),
		 *  and this row alone is the audit trail; there's no separate charge to point to.
		 *  Reserved for a possible future *staff-applied* redemption against an
		 *  already-created (and already-folioed) booking, which would need the
		 *  `sc_pwd_discounts.folio_charge_id` posture — a plain uuid, no FK, populated from a
		 *  `tx.insert(folioCharges)` in the same transaction — since that booking's total is
		 *  already frozen and can't be discounted in place. */
		folioChargeId: uuid('folio_charge_id'),
		voidedByUserId: uuid('voided_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		voidedAt: timestamp('voided_at', { withTimezone: true }),
		voidReason: text('void_reason'),
		createdAt: createdAt()
	},
	(t) => [
		index('promo_redemptions_hotel_idx').on(t.hotelId),
		index('promo_redemptions_booking_idx').on(t.bookingId),
		index('promo_redemptions_promo_code_idx').on(t.promoCodeId)
	]
);

export const promoCodesRelations = relations(promoCodes, ({ one, many }) => ({
	hotel: one(hotels, { fields: [promoCodes.hotelId], references: [hotels.id] }),
	redemptions: many(promoRedemptions)
}));

export const promoRedemptionsRelations = relations(promoRedemptions, ({ one }) => ({
	hotel: one(hotels, { fields: [promoRedemptions.hotelId], references: [hotels.id] }),
	promoCode: one(promoCodes, { fields: [promoRedemptions.promoCodeId], references: [promoCodes.id] }),
	booking: one(bookings, { fields: [promoRedemptions.bookingId], references: [bookings.id] }),
	voidedBy: one(users, { fields: [promoRedemptions.voidedByUserId], references: [users.id] })
}));

export type PromoCode = typeof promoCodes.$inferSelect;
export type NewPromoCode = typeof promoCodes.$inferInsert;
export type PromoRedemption = typeof promoRedemptions.$inferSelect;
