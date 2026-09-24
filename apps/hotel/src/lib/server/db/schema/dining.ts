import { relations } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, pk, updatedAt } from './_shared';
import { hotels } from './hotels';

/** One `{ url, tag }` photo in a dining venue's gallery — same shape as `RoomPhoto`
 *  (`schema/inventory.ts`), kept as its own local type rather than a cross-domain
 *  import since dining has no other dependency on the inventory schema. */
export interface DiningPhoto {
	url: string;
	tag: string;
}

/**
 * One dining venue/offering shown on the public Dining page — a restaurant, bar,
 * café, or similar. Deliberately simpler than a full bookable product like
 * `roomTypes`/`functionHalls` — no pricing, capacity, or availability — since
 * dining isn't sold or reserved through this app, just presented.
 */
export const diningItems = pgTable(
	'dining_items',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		/** Short venue type shown as a tag on its card, e.g. "Restaurant", "Coffee Shop"
		 *  — free text (not an enum), since venue types vary too widely hotel to hotel. */
		category: text('category'),
		/** One-line pitch shown under the title on the venue's own section, e.g.
		 *  "Local & international cuisine, all day." Optional. */
		tagline: text('tagline'),
		description: text('description'),
		/** `string[]` — 2-4 short selling points shown as a checklist, e.g. "Live
		 *  coffee brewing bar". Empty array renders nothing, same as any other optional field here. */
		highlights: jsonb('highlights').notNull().default([]),
		/** `DiningPhoto[]` — a small gallery per venue. One `cover` shot (used on the
		 *  teaser card) plus optional `gallery` shots (used in the full section below it),
		 *  same cover/gallery convention `room_types.photos` already established. */
		photos: jsonb('photos').notNull().default([]),
		/** Free text, e.g. "6:00 AM – 10:00 PM". Optional — omitted entirely on the public page if unset. */
		operatingHours: text('operating_hours'),
		isActive: boolean('is_active').notNull().default(true),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: deletedAt()
	},
	(t) => [index('dining_items_hotel_idx').on(t.hotelId)]
);

export const diningItemsRelations = relations(diningItems, ({ one }) => ({
	hotel: one(hotels, { fields: [diningItems.hotelId], references: [hotels.id] })
}));

export type DiningItem = typeof diningItems.$inferSelect;
export type NewDiningItem = typeof diningItems.$inferInsert;
