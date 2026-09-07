import { relations, sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, pk, updatedAt } from './_shared';
import { hotels } from './hotels';
import { bookings, hallBookings } from './bookings';
import { users } from './auth';

/**
 * A sellable incidental service/item front desk can add to a guest's folio —
 * e.g. "Extra towels", "Minibar water", "Spa massage". Distinct from the
 * `amenities` table (`amenities.ts`), which is purely descriptive/marketing
 * copy shown to guests and was never priced or bookable.
 */
export const amenityItems = pgTable(
	'amenity_items',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		/** Free-form grouping label for the settings list (e.g. "Food & Beverage", "Services") — optional. */
		category: text('category'),
		priceCentavos: bigint('price_centavos', { mode: 'number' }).notNull(),
		taxable: boolean('taxable').notNull().default(true),
		isActive: boolean('is_active').notNull().default(true),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: deletedAt()
	},
	(t) => [index('amenity_items_hotel_idx').on(t.hotelId)]
);

export const folioStatus = pgEnum('folio_status', ['open', 'closed']);

/**
 * One per booking (room stay) *or* per hall booking (function hall reservation) — never
 * both, enforced by the check constraint below — the running ledger of everything charged
 * on top of it. Created on demand (`ensureFolio`) the first time anyone views or charges it,
 * seeded with a single line equal to the booking/hall booking's own already-priced total —
 * that line's matching payment already exists (the original payment, `payments.orderId`), so
 * the folio's math starts exactly balanced and only owes anything once a new charge is added
 * without a matching new payment. Closed (and `closedAt` set) once a room booking actually
 * checks out — a hall booking's folio has no equivalent close step yet.
 */
export const folios = pgTable(
	'folios',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		bookingId: uuid('booking_id').unique().references(() => bookings.id, { onDelete: 'cascade' }),
		hallBookingId: uuid('hall_booking_id')
			.unique()
			.references(() => hallBookings.id, { onDelete: 'cascade' }),
		status: folioStatus('status').notNull().default('open'),
		closedAt: timestamp('closed_at', { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('folios_hotel_idx').on(t.hotelId),
		check(
			'folios_exactly_one_target',
			sql`(${t.bookingId} is not null) <> (${t.hallBookingId} is not null)`
		)
	]
);

/**
 * One line item on a folio — either the seeded room-charge line (`amenityItemId`
 * null, `description` free text) or a sold `amenityItems` catalog item/extension
 * fee. `taxCentavos` is snapshotted at add-time from the hotel's `vatRateBps` and
 * the item's own `taxable` flag, so a later VAT-rate change can't rewrite an
 * already-added charge — same snapshot posture `bookings.*Centavos` already uses.
 */
export const folioCharges = pgTable(
	'folio_charges',
	{
		id: pk(),
		folioId: uuid('folio_id')
			.notNull()
			.references(() => folios.id, { onDelete: 'cascade' }),
		amenityItemId: uuid('amenity_item_id').references(() => amenityItems.id, { onDelete: 'set null' }),
		description: text('description').notNull(),
		quantity: integer('quantity').notNull().default(1),
		unitPriceCentavos: bigint('unit_price_centavos', { mode: 'number' }).notNull(),
		taxCentavos: bigint('tax_centavos', { mode: 'number' }).notNull().default(0),
		/** `quantity * unitPriceCentavos + taxCentavos` — the actual amount this line adds to the balance. */
		totalCentavos: bigint('total_centavos', { mode: 'number' }).notNull(),
		/** True only for the one seeded line `ensureFolio` inserts when the folio is created — the
		 *  room/hall booking's own already-paid total. Never voidable: voiding it would zero out the
		 *  guest's core stay charge, unlike every other line which is a genuine incidental add-on. */
		isBaseCharge: boolean('is_base_charge').notNull().default(false),
		/** Soft-void: kept for the audit trail (who added it, who voided it, why) rather than deleted
		 *  outright — excluded from the folio balance once set, but still shown (struck through) so
		 *  the ledger stays honest about what actually happened during the stay. */
		voidedAt: timestamp('voided_at', { withTimezone: true }),
		voidedByUserId: uuid('voided_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		voidReason: text('void_reason'),
		addedByUserId: uuid('added_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(t) => [index('folio_charges_folio_idx').on(t.folioId)]
);

export const amenityItemsRelations = relations(amenityItems, ({ one, many }) => ({
	hotel: one(hotels, { fields: [amenityItems.hotelId], references: [hotels.id] }),
	folioCharges: many(folioCharges)
}));

export const foliosRelations = relations(folios, ({ one, many }) => ({
	hotel: one(hotels, { fields: [folios.hotelId], references: [hotels.id] }),
	booking: one(bookings, { fields: [folios.bookingId], references: [bookings.id] }),
	hallBooking: one(hallBookings, { fields: [folios.hallBookingId], references: [hallBookings.id] }),
	charges: many(folioCharges)
}));

export const folioChargesRelations = relations(folioCharges, ({ one }) => ({
	folio: one(folios, { fields: [folioCharges.folioId], references: [folios.id] }),
	amenityItem: one(amenityItems, { fields: [folioCharges.amenityItemId], references: [amenityItems.id] }),
	addedBy: one(users, { fields: [folioCharges.addedByUserId], references: [users.id] }),
	voidedBy: one(users, { fields: [folioCharges.voidedByUserId], references: [users.id] })
}));

export type AmenityItem = typeof amenityItems.$inferSelect;
export type NewAmenityItem = typeof amenityItems.$inferInsert;
export type Folio = typeof folios.$inferSelect;
export type FolioCharge = typeof folioCharges.$inferSelect;
