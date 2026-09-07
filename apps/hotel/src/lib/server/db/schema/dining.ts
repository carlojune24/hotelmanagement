import { relations } from 'drizzle-orm';
import { boolean, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, pk, updatedAt } from './_shared';
import { hotels } from './hotels';

/**
 * One dining venue/offering shown on the public Dining page — a restaurant, bar,
 * café, or similar. Deliberately simple (a title, one photo, free-text description
 * and hours) rather than a full bookable product like `roomTypes`/`functionHalls`;
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
		description: text('description'),
		/** Single stored image reference (`/uploads/<hotelId>/<file>`), same convention `lib/server/uploads.ts` writes elsewhere. */
		photoUrl: text('photo_url'),
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
