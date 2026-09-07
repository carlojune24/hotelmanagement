import { relations } from 'drizzle-orm';
import { bigint, boolean, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, pk, updatedAt } from './_shared';
import { hotels } from './hotels';

/**
 * A bookable event space, rented by the hour rather than the night (weddings,
 * birthdays, corporate events, seminars, …) — a sellable product parallel to
 * `roomTypes` in `inventory.ts`, but priced and booked on a fundamentally
 * different shape (see `pricing.ts`'s `priceEventHall` and `hallBookings`
 * below), so it gets its own table rather than being bolted onto room types.
 */
export const functionHalls = pgTable(
	'function_halls',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		description: text('description'),
		/** `RoomPhoto[]` — same `{url, tag}` shape as a room type's gallery (see `inventory.ts`). */
		photos: jsonb('photos').notNull().default([]),
		capacity: integer('capacity').notNull(),
		/** Hours included in `basePriceCentavos` before `extraHourFeeCentavos` kicks in. */
		baseHours: integer('base_hours').notNull(),
		basePriceCentavos: bigint('base_price_centavos', { mode: 'number' }).notNull(),
		extraHourFeeCentavos: bigint('extra_hour_fee_centavos', { mode: 'number' }).notNull(),
		/** e.g. ["Tables & chairs", "Air-conditioned venue", "Basic sound system", "Projector"]. */
		includedServices: text('included_services').array().notNull().default([]),
		/** e.g. ["Wedding", "Birthday", "Corporate event"] — admin-editable per hotel, not a fixed enum. */
		supportedEventTypes: text('supported_event_types').array().notNull().default([]),
		isActive: boolean('is_active').notNull().default(true),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: deletedAt()
	},
	(t) => [index('function_halls_hotel_idx').on(t.hotelId)]
);

export const functionHallsRelations = relations(functionHalls, ({ one }) => ({
	hotel: one(hotels, { fields: [functionHalls.hotelId], references: [hotels.id] })
}));

export type FunctionHall = typeof functionHalls.$inferSelect;
export type NewFunctionHall = typeof functionHalls.$inferInsert;
