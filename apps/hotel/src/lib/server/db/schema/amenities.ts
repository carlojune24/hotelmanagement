import { relations } from 'drizzle-orm';
import {
	boolean,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, pk, updatedAt } from './_shared';
import { hotels } from './hotels';
import { roomTypes } from './inventory';

/**
 * How guests scan an amenity list — mirrors the grouping shown on a booking page
 * ("Connectivity", "Bathroom", …). `general` is the catch-all.
 */
export const amenityCategory = pgEnum('amenity_category', [
	'connectivity',
	'comfort',
	'bathroom',
	'entertainment',
	'kitchen',
	'outdoor_view',
	'safety',
	'accessibility',
	'services',
	'general'
]);

/**
 * The level an amenity naturally applies at. Drives which pickers offer it:
 * `hotel` shows only in hotel-wide settings, `room_type` only on a room type,
 * `both` in either.
 */
export const amenityScope = pgEnum('amenity_scope', ['hotel', 'room_type', 'both']);

/**
 * Per-hotel master list of informational amenities (Free WiFi, Air Conditioning,
 * Balcony, Swimming Pool …). Purely descriptive — things a guest pays extra for
 * (breakfast, paid parking) live in `rate_plans.inclusions` or, once Phase 2
 * lands, the sellable `amenity_items` catalogue. Seeded from
 * `STANDARD_AMENITIES` on hotel creation; a hotel may rename, add, or hide its
 * own entries.
 */
export const amenities = pgTable(
	'amenities',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		/** Stable key for dedupe / matching the seed catalogue. Unique per hotel. */
		slug: text('slug').notNull(),
		/** Lucide icon name for UI display, e.g. `wifi`. Optional. */
		icon: text('icon'),
		category: amenityCategory('category').notNull().default('general'),
		scope: amenityScope('scope').notNull().default('both'),
		description: text('description'),
		sortOrder: integer('sort_order').notNull().default(0),
		/** False = kept for history but not offered in pickers. */
		isActive: boolean('is_active').notNull().default(true),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: deletedAt()
	},
	(t) => [
		index('amenities_hotel_idx').on(t.hotelId),
		uniqueIndex('amenities_hotel_slug_idx').on(t.hotelId, t.slug)
	]
);

/** Amenity offered property-wide (pool, 24h front desk, parking). */
export const hotelAmenities = pgTable(
	'hotel_amenities',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		amenityId: uuid('amenity_id')
			.notNull()
			.references(() => amenities.id, { onDelete: 'cascade' }),
		/** Optional qualifier shown next to the amenity, e.g. "Open 6am–10pm". */
		note: text('note'),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: createdAt()
	},
	(t) => [
		index('hotel_amenities_hotel_idx').on(t.hotelId),
		uniqueIndex('hotel_amenities_hotel_amenity_idx').on(t.hotelId, t.amenityId)
	]
);

/** Amenity that applies to every room of a given type (AC, minibar, balcony). */
export const roomTypeAmenities = pgTable(
	'room_type_amenities',
	{
		id: pk(),
		/** Denormalised from the room type so tenant-scoped queries stay simple. */
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		roomTypeId: uuid('room_type_id')
			.notNull()
			.references(() => roomTypes.id, { onDelete: 'cascade' }),
		amenityId: uuid('amenity_id')
			.notNull()
			.references(() => amenities.id, { onDelete: 'cascade' }),
		/** Shown as an icon on the room card / summary; the rest sit behind "See all". */
		isHighlighted: boolean('is_highlighted').notNull().default(false),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: createdAt()
	},
	(t) => [
		index('room_type_amenities_hotel_idx').on(t.hotelId),
		index('room_type_amenities_room_type_idx').on(t.roomTypeId),
		uniqueIndex('room_type_amenities_type_amenity_idx').on(t.roomTypeId, t.amenityId)
	]
);

export const amenitiesRelations = relations(amenities, ({ one, many }) => ({
	hotel: one(hotels, { fields: [amenities.hotelId], references: [hotels.id] }),
	hotelLinks: many(hotelAmenities),
	roomTypeLinks: many(roomTypeAmenities)
}));

export const hotelAmenitiesRelations = relations(hotelAmenities, ({ one }) => ({
	hotel: one(hotels, { fields: [hotelAmenities.hotelId], references: [hotels.id] }),
	amenity: one(amenities, { fields: [hotelAmenities.amenityId], references: [amenities.id] })
}));

export const roomTypeAmenitiesRelations = relations(roomTypeAmenities, ({ one }) => ({
	hotel: one(hotels, { fields: [roomTypeAmenities.hotelId], references: [hotels.id] }),
	roomType: one(roomTypes, {
		fields: [roomTypeAmenities.roomTypeId],
		references: [roomTypes.id]
	}),
	amenity: one(amenities, { fields: [roomTypeAmenities.amenityId], references: [amenities.id] })
}));

export type Amenity = typeof amenities.$inferSelect;
export type NewAmenity = typeof amenities.$inferInsert;
export type HotelAmenity = typeof hotelAmenities.$inferSelect;
export type RoomTypeAmenity = typeof roomTypeAmenities.$inferSelect;
