import { relations } from 'drizzle-orm';
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
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
 * `roomTypes`/`functionHalls` — no pricing, capacity, or availability. The sellable
 * menu hangs off a venue (see `diningMenuItems` below).
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

/**
 * A prep/production station — "Kitchen", "Bar", "Pastry". Hotel-wide (not per venue) so
 * reports can compare stations across venues. Deleting one leaves its dishes unassigned.
 */
export const diningStations = pgTable(
	'dining_stations',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [uniqueIndex('dining_stations_hotel_name_uq').on(t.hotelId, t.name)]
);

/** A section of a venue's menu ("Mains", "Drinks"). Hard-deleting one leaves its items
 *  uncategorised (`category_id` set null) rather than deleting them. */
export const diningMenuCategories = pgTable(
	'dining_menu_categories',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		diningItemId: uuid('dining_item_id')
			.notNull()
			.references(() => diningItems.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('dining_menu_categories_venue_idx').on(t.hotelId, t.diningItemId)]
);

/**
 * One sellable dish/drink on a venue's menu. Money is integer centavos. `isAvailable` is
 * the quick "sold out today" switch staff flip during service; `isActive` hides an item
 * from the menu entirely. `stationId` optionally routes the dish to a prep station (kitchen,
 * bar…) — the kitchen board ignores it today, but sales reports can already group by it and
 * splitting the board per station later needs no data migration.
 */
export const diningMenuItems = pgTable(
	'dining_menu_items',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		diningItemId: uuid('dining_item_id')
			.notNull()
			.references(() => diningItems.id, { onDelete: 'cascade' }),
		categoryId: uuid('category_id').references(() => diningMenuCategories.id, {
			onDelete: 'set null'
		}),
		stationId: uuid('station_id').references(() => diningStations.id, { onDelete: 'set null' }),
		name: text('name').notNull(),
		description: text('description'),
		priceCentavos: integer('price_centavos').notNull(),
		taxable: boolean('taxable').notNull().default(true),
		isAvailable: boolean('is_available').notNull().default(true),
		isActive: boolean('is_active').notNull().default(true),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: deletedAt()
	},
	(t) => [
		index('dining_menu_items_venue_idx').on(t.hotelId, t.diningItemId),
		index('dining_menu_items_category_idx').on(t.categoryId)
	]
);

/** A named set of optional extras ("Choose a sauce", "Extras") that can attach to many
 *  items. `minChoices`/`maxChoices` bound how many the guest picks: min 0 = optional,
 *  min 1 = required, max null = no cap. */
export const diningAddonGroups = pgTable(
	'dining_addon_groups',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		diningItemId: uuid('dining_item_id')
			.notNull()
			.references(() => diningItems.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		minChoices: integer('min_choices').notNull().default(0),
		maxChoices: integer('max_choices'),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('dining_addon_groups_venue_idx').on(t.hotelId, t.diningItemId)]
);

export const diningAddons = pgTable(
	'dining_addons',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		groupId: uuid('group_id')
			.notNull()
			.references(() => diningAddonGroups.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		priceCentavos: integer('price_centavos').notNull().default(0),
		isAvailable: boolean('is_available').notNull().default(true),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('dining_addons_group_idx').on(t.groupId)]
);

/** Which add-on groups a menu item offers. */
export const diningMenuItemAddonGroups = pgTable(
	'dining_menu_item_addon_groups',
	{
		menuItemId: uuid('menu_item_id')
			.notNull()
			.references(() => diningMenuItems.id, { onDelete: 'cascade' }),
		addonGroupId: uuid('addon_group_id')
			.notNull()
			.references(() => diningAddonGroups.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.menuItemId, t.addonGroupId] })]
);

export type DiningStation = typeof diningStations.$inferSelect;
export type DiningMenuCategory = typeof diningMenuCategories.$inferSelect;
export type DiningMenuItem = typeof diningMenuItems.$inferSelect;
export type DiningAddonGroup = typeof diningAddonGroups.$inferSelect;
export type DiningAddon = typeof diningAddons.$inferSelect;
