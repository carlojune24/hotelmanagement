import { relations } from 'drizzle-orm';
import {
	bigint,
	boolean,
	date,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, pk, updatedAt } from './_shared';
import { hotels } from './hotels';

export const smokingPolicy = pgEnum('smoking_policy', ['non_smoking', 'smoking_allowed']);

/** Marketing class a room type belongs to. Drives listing grouping / OTA mapping. */
export const roomCategory = pgEnum('room_category', ['standard', 'deluxe', 'suite', 'executive']);

/** One `{ type: "King", quantity: 1 }` entry in a room type's bed configuration. */
export interface BedConfigEntry {
	type: string;
	quantity: number;
}

/** One `{ url, tag }` photo in a room's gallery. `tag` e.g. "cover", "bathroom", "view". */
export interface RoomPhoto {
	url: string;
	tag: string;
}

/**
 * A sellable room product (e.g. "Deluxe Twin"). Physical inventory lives in
 * `rooms`. Spec and marketing attributes below are shared by every room of
 * this type — they don't vary per physical room.
 */
export const roomTypes = pgTable(
	'room_types',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		/** Short internal code, e.g. `DLX-K`. Unique per hotel when set. */
		code: text('code'),
		/** Marketing class (Standard / Deluxe / Suite / Executive). Null = uncategorised. */
		category: roomCategory('category'),
		/** Full marketing copy. Distinct from `shortDescription`, used for listing cards. */
		description: text('description'),
		/**
		 * `RoomPhoto[]` — the gallery guests and OTAs compare by. Individual rooms
		 * may still carry supplementary `rooms.photos` for genuinely unique units.
		 */
		photos: jsonb('photos').notNull().default([]),
		sortOrder: integer('sort_order').notNull().default(0),

		// Capacity
		baseOccupancy: integer('base_occupancy').notNull().default(2),
		maxOccupancy: integer('max_occupancy').notNull().default(2),
		maxAdults: integer('max_adults'),
		maxChildren: integer('max_children'),
		extraBedAllowed: boolean('extra_bed_allowed').notNull().default(false),
		maxExtraBeds: integer('max_extra_beds'),

		// Spec
		sizeSqm: integer('size_sqm'),
		/** `BedConfigEntry[]`, e.g. `[{ type: "King", quantity: 1 }]`. */
		bedConfiguration: jsonb('bed_configuration').notNull().default([]),
		bedFlexible: boolean('bed_flexible').notNull().default(false),
		flexibilityNote: text('flexibility_note'),

		// Features — the descriptive amenity list lives in `room_type_amenities`
		// (see schema/amenities.ts); these stay as columns because they're
		// filterable structured attributes, not free-form list items.
		viewType: text('view_type'),
		wheelchairAccessible: boolean('wheelchair_accessible').notNull().default(false),
		rollInShower: boolean('roll_in_shower').notNull().default(false),
		grabBars: boolean('grab_bars').notNull().default(false),
		smokingPolicy: smokingPolicy('smoking_policy').notNull().default('non_smoking'),

		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: deletedAt()
	},
	(t) => [
		index('room_types_hotel_idx').on(t.hotelId),
		uniqueIndex('room_types_hotel_code_idx').on(t.hotelId, t.code)
	]
);

export const roomOperationalStatus = pgEnum('room_operational_status', [
	'available',
	'out_of_order',
	'under_maintenance'
]);

/** One physical room. Availability = available rooms of a type minus overlapping bookings. */
export const rooms = pgTable(
	'rooms',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		roomTypeId: uuid('room_type_id')
			.notNull()
			.references(() => roomTypes.id, { onDelete: 'cascade' }),
		roomNumber: text('room_number').notNull(),
		floor: text('floor'),
		buildingBlock: text('building_block'),
		notes: text('notes'),
		operationalStatus: roomOperationalStatus('operational_status').notNull().default('available'),
		/** Has an internal connecting door to an adjacent room. */
		isConnecting: boolean('is_connecting').notNull().default(false),
		/** False = temporarily pulled from inventory without deleting it. */
		isActive: boolean('is_active').notNull().default(true),

		// Media & marketing — per physical room, not shared across the type.
		displayTitle: text('display_title'),
		tagline: text('tagline'),
		shortDescription: text('short_description'),
		/** `RoomPhoto[]`. URLs only for now — no upload/storage backend yet. */
		photos: jsonb('photos').notNull().default([]),

		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: deletedAt()
	},
	(t) => [
		index('rooms_hotel_idx').on(t.hotelId),
		index('rooms_room_type_idx').on(t.roomTypeId),
		uniqueIndex('rooms_hotel_number_idx').on(t.hotelId, t.roomNumber)
	]
);

export const cancellationPenaltyType = pgEnum('cancellation_penalty_type', [
	'percentage_of_total',
	'first_night',
	'full_amount'
]);

export const cancellationPolicies = pgTable(
	'cancellation_policies',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		description: text('description'),
		/** Hours before check-in the guest can still cancel free of charge. Null = never free. */
		freeCancelHours: integer('free_cancel_hours'),
		penaltyType: cancellationPenaltyType('penalty_type').notNull().default('full_amount'),
		/** Basis points of the booking total; only used when penaltyType = 'percentage_of_total'. */
		penaltyValueBps: integer('penalty_value_bps'),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: deletedAt()
	},
	(t) => [index('cancellation_policies_hotel_idx').on(t.hotelId)]
);

/**
 * A priced, bookable product for one room type (e.g. "Standard Rate",
 * "Non-refundable Promo"). `basePriceCentavos` is the default nightly price;
 * `daily_rates` rows override specific dates (seasonal pricing).
 */
export const ratePlans = pgTable(
	'rate_plans',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		roomTypeId: uuid('room_type_id')
			.notNull()
			.references(() => roomTypes.id, { onDelete: 'cascade' }),
		cancellationPolicyId: uuid('cancellation_policy_id').references(() => cancellationPolicies.id, {
			onDelete: 'set null'
		}),
		name: text('name').notNull(),
		description: text('description'),
		/** What the price includes beyond the room, e.g. `["Breakfast", "Parking"]`. */
		inclusions: text('inclusions').array().notNull().default([]),
		basePriceCentavos: bigint('base_price_centavos', { mode: 'number' }).notNull(),
		/**
		 * Nightly price on weekend nights (see `weekendDays`). Null = weekends use
		 * `basePriceCentavos`. Overridden by `daily_rates` / `seasonal_rates`.
		 */
		weekendPriceCentavos: bigint('weekend_price_centavos', { mode: 'number' }),
		/** Which weekdays count as "weekend", as JS `getUTCDay()` values (0 = Sun … 6 = Sat). */
		weekendDays: integer('weekend_days').array().notNull().default([5, 6]),
		/** Charged per adult beyond the room type's base occupancy. */
		extraPersonFeeCentavos: bigint('extra_person_fee_centavos', { mode: 'number' }),
		/** Charged per child beyond base occupancy, for children older than `childFreeMaxAge`. */
		extraChildFeeCentavos: bigint('extra_child_fee_centavos', { mode: 'number' }),
		/** Children at or under this age stay free (not counted for extra-person fees). Null = no free-child rule. */
		childFreeMaxAge: integer('child_free_max_age'),
		/** Flat charge per rollaway / extra bed added to the room. */
		extraBedFeeCentavos: bigint('extra_bed_fee_centavos', { mode: 'number' }),
		/** Flat security deposit collected at booking, if any. */
		depositCentavos: bigint('deposit_centavos', { mode: 'number' }),
		/** Stay-length limits for this plan to be bookable. Null = unbounded. */
		minStayNights: integer('min_stay_nights'),
		maxStayNights: integer('max_stay_nights'),
		promoCode: text('promo_code'),
		isActive: boolean('is_active').notNull().default(true),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: deletedAt()
	},
	(t) => [
		index('rate_plans_hotel_idx').on(t.hotelId),
		index('rate_plans_room_type_idx').on(t.roomTypeId),
		uniqueIndex('rate_plans_promo_code_idx').on(t.hotelId, t.promoCode)
	]
);

/** Per-date price override for a rate plan. Absence of a row = use the plan's base price. */
export const dailyRates = pgTable(
	'daily_rates',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		ratePlanId: uuid('rate_plan_id')
			.notNull()
			.references(() => ratePlans.id, { onDelete: 'cascade' }),
		date: date('date', { mode: 'string' }).notNull(),
		priceCentavos: bigint('price_centavos', { mode: 'number' }).notNull(),
		minStayNights: integer('min_stay_nights'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('daily_rates_hotel_idx').on(t.hotelId),
		uniqueIndex('daily_rates_plan_date_idx').on(t.ratePlanId, t.date)
	]
);

/**
 * A named date range (holiday season, low season) that shifts a rate plan's
 * nightly price. Either an absolute `priceCentavos` or a `multiplierBps` applied
 * to the otherwise-computed nightly rate (base or weekend). A `daily_rates` row
 * for an exact date still wins over any seasonal range.
 */
export const seasonalRates = pgTable(
	'seasonal_rates',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		ratePlanId: uuid('rate_plan_id')
			.notNull()
			.references(() => ratePlans.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		/** Inclusive `YYYY-MM-DD` bounds — every night from `startDate` to `endDate`. */
		startDate: date('start_date', { mode: 'string' }).notNull(),
		endDate: date('end_date', { mode: 'string' }).notNull(),
		/** Absolute nightly price for the range. Takes precedence over `multiplierBps`. */
		priceCentavos: bigint('price_centavos', { mode: 'number' }),
		/** Basis points applied to the baseline nightly rate (10000 = ×1, 13000 = +30%). */
		multiplierBps: integer('multiplier_bps'),
		minStayNights: integer('min_stay_nights'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('seasonal_rates_hotel_idx').on(t.hotelId),
		index('seasonal_rates_plan_idx').on(t.ratePlanId)
	]
);

export const taxFeeType = pgEnum('tax_fee_type', ['percentage', 'fixed']);
export const taxFeeAppliesTo = pgEnum('tax_fee_applies_to', ['per_night', 'per_stay']);

/**
 * Configurable fees beyond VAT (e.g. resort fee, reservation fee). VAT itself
 * stays on `hotels.vatRateBps` since it's a single hotel-wide rate already
 * wired into Phase 0 admin config.
 */
export const taxesFees = pgTable(
	'taxes_fees',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		type: taxFeeType('type').notNull(),
		/** Basis points of the taxable subtotal; only used when type = 'percentage'. */
		valueBps: integer('value_bps'),
		/** Flat amount in centavos; only used when type = 'fixed'. */
		valueCentavos: bigint('value_centavos', { mode: 'number' }),
		appliesTo: taxFeeAppliesTo('applies_to').notNull().default('per_stay'),
		isActive: boolean('is_active').notNull().default(true),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: deletedAt()
	},
	(t) => [index('taxes_fees_hotel_idx').on(t.hotelId)]
);

export const roomTypesRelations = relations(roomTypes, ({ one, many }) => ({
	hotel: one(hotels, { fields: [roomTypes.hotelId], references: [hotels.id] }),
	rooms: many(rooms),
	ratePlans: many(ratePlans)
}));

export const roomsRelations = relations(rooms, ({ one }) => ({
	hotel: one(hotels, { fields: [rooms.hotelId], references: [hotels.id] }),
	roomType: one(roomTypes, { fields: [rooms.roomTypeId], references: [roomTypes.id] })
}));

export const cancellationPoliciesRelations = relations(cancellationPolicies, ({ one, many }) => ({
	hotel: one(hotels, { fields: [cancellationPolicies.hotelId], references: [hotels.id] }),
	ratePlans: many(ratePlans)
}));

export const ratePlansRelations = relations(ratePlans, ({ one, many }) => ({
	hotel: one(hotels, { fields: [ratePlans.hotelId], references: [hotels.id] }),
	roomType: one(roomTypes, { fields: [ratePlans.roomTypeId], references: [roomTypes.id] }),
	cancellationPolicy: one(cancellationPolicies, {
		fields: [ratePlans.cancellationPolicyId],
		references: [cancellationPolicies.id]
	}),
	dailyRates: many(dailyRates),
	seasonalRates: many(seasonalRates)
}));

export const dailyRatesRelations = relations(dailyRates, ({ one }) => ({
	hotel: one(hotels, { fields: [dailyRates.hotelId], references: [hotels.id] }),
	ratePlan: one(ratePlans, { fields: [dailyRates.ratePlanId], references: [ratePlans.id] })
}));

export const seasonalRatesRelations = relations(seasonalRates, ({ one }) => ({
	hotel: one(hotels, { fields: [seasonalRates.hotelId], references: [hotels.id] }),
	ratePlan: one(ratePlans, { fields: [seasonalRates.ratePlanId], references: [ratePlans.id] })
}));

export const taxesFeesRelations = relations(taxesFees, ({ one }) => ({
	hotel: one(hotels, { fields: [taxesFees.hotelId], references: [hotels.id] })
}));

export type RoomType = typeof roomTypes.$inferSelect;
export type NewRoomType = typeof roomTypes.$inferInsert;
export type Room = typeof rooms.$inferSelect;
export type NewRoom = typeof rooms.$inferInsert;
export type CancellationPolicy = typeof cancellationPolicies.$inferSelect;
export type RatePlan = typeof ratePlans.$inferSelect;
export type NewRatePlan = typeof ratePlans.$inferInsert;
export type DailyRate = typeof dailyRates.$inferSelect;
export type SeasonalRate = typeof seasonalRates.$inferSelect;
export type NewSeasonalRate = typeof seasonalRates.$inferInsert;
export type TaxFee = typeof taxesFees.$inferSelect;
