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
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, pk, updatedAt } from './_shared';
import { users } from './auth';
import { bookings, paymentMethod } from './bookings';
import { cashAccounts, cashierShifts } from './finance';
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
		/** Online/staff table reservations for this venue. Off until the venue is set up
		 *  (tables added, seating hours chosen) so guests never see an empty booking form. */
		reservationsEnabled: boolean('reservations_enabled').notNull().default(false),
		/** Seating hours as `HH:MM` in the hotel's timezone: first and last seating start. */
		seatingOpen: text('seating_open'),
		lastSeating: text('last_seating'),
		/** Gap between offered start times (minutes). */
		slotMinutes: integer('slot_minutes').notNull().default(30),
		/** How long a party holds its table (minutes) — the turn time conflicts are checked against. */
		turnMinutes: integer('turn_minutes').notNull().default(90),
		/** Largest party a guest may book online. */
		maxPartySize: integer('max_party_size').notNull().default(8),
		/** How far ahead (days) and how late (minutes before the slot) a guest may book. */
		advanceDays: integer('advance_days').notNull().default(60),
		minNoticeMinutes: integer('min_notice_minutes').notNull().default(60),
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

/** A named table on a venue's floor plan. `x`/`y` are grid cells on the plan canvas. */
export const diningTables = pgTable(
	'dining_tables',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		diningItemId: uuid('dining_item_id')
			.notNull()
			.references(() => diningItems.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		seats: integer('seats').notNull(),
		/** Optional zone label, e.g. "Terrace", "Indoor". */
		area: text('area'),
		x: integer('x').notNull().default(0),
		y: integer('y').notNull().default(0),
		isActive: boolean('is_active').notNull().default(true),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('dining_tables_venue_idx').on(t.hotelId, t.diningItemId),
		uniqueIndex('dining_tables_venue_name_uq').on(t.diningItemId, t.name)
	]
);

export const diningReservationStatus = pgEnum('dining_reservation_status', [
	'pending',
	'confirmed',
	'seated',
	'completed',
	'no_show',
	'cancelled'
]);

/**
 * A table reservation. `code` is the short reference the guest quotes (`TB-7K4Q`),
 * unique per hotel; `accessToken` guards the guest's own confirmation/tracking page.
 * `bookingId` links an in-house guest's stay (traceability: staff see booking code and
 * guest name). Times are absolute instants; the hotel's timezone only matters for display.
 */
export const diningReservations = pgTable(
	'dining_reservations',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		diningItemId: uuid('dining_item_id')
			.notNull()
			.references(() => diningItems.id, { onDelete: 'cascade' }),
		code: text('code').notNull(),
		accessToken: uuid('access_token').notNull().defaultRandom(),
		status: diningReservationStatus('status').notNull().default('pending'),
		guestName: text('guest_name').notNull(),
		guestPhone: text('guest_phone'),
		guestEmail: text('guest_email'),
		partySize: integer('party_size').notNull(),
		startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
		endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
		remarks: text('remarks'),
		/** 'online' (guest) or 'staff' (phone / walk-in). */
		source: text('source').notNull().default('online'),
		bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
		createdByUserId: uuid('created_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('dining_reservations_code_uq').on(t.hotelId, t.code),
		index('dining_reservations_venue_time_idx').on(t.hotelId, t.diningItemId, t.startsAt)
	]
);

/** The table(s) a reservation holds. Usually one; staff may join tables for a large party. */
export const diningReservationTables = pgTable(
	'dining_reservation_tables',
	{
		reservationId: uuid('reservation_id')
			.notNull()
			.references(() => diningReservations.id, { onDelete: 'cascade' }),
		tableId: uuid('table_id')
			.notNull()
			.references(() => diningTables.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.reservationId, t.tableId] }), index('dining_res_tables_table_idx').on(t.tableId)]
);

export type DiningTable = typeof diningTables.$inferSelect;
export type DiningReservation = typeof diningReservations.$inferSelect;
export type DiningReservationStatus = (typeof diningReservationStatus.enumValues)[number];

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/** Kitchen flow. Paid/unpaid is tracked separately (`dining_payment_status`). */
export const diningOrderStatus = pgEnum('dining_order_status', [
	'new',
	'accepted',
	'preparing',
	'ready',
	'served',
	'cancelled'
]);

export const diningOrderType = pgEnum('dining_order_type', ['dine_in', 'takeaway', 'pre_order']);

/** `room_charged` is reserved for charge-to-room (a later phase); nothing sets it yet. */
export const diningPaymentStatus = pgEnum('dining_payment_status', ['unpaid', 'paid', 'room_charged']);

/**
 * One dining order. Money is integer centavos and VAT-inclusive: `totalCentavos` is what the
 * guest pays and `vatCentavos` is the VAT already inside it. Items are snapshotted so a later
 * menu edit never rewrites history. A cashier-paid order records its own payment here and posts
 * to the cash ledger as `dining_revenue` (via `recordCashMovement`); it never touches `payments`
 * (which is order/room-bound) or a room folio.
 */
export const diningOrders = pgTable(
	'dining_orders',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		diningItemId: uuid('dining_item_id')
			.notNull()
			.references(() => diningItems.id, { onDelete: 'cascade' }),
		/** Short reference the guest/staff quote (`DN-7K4Q`), unique per hotel. */
		code: text('code').notNull(),
		accessToken: uuid('access_token').notNull().defaultRandom(),
		status: diningOrderStatus('status').notNull().default('new'),
		orderType: diningOrderType('order_type').notNull().default('dine_in'),
		paymentStatus: diningPaymentStatus('payment_status').notNull().default('unpaid'),
		tableId: uuid('table_id').references(() => diningTables.id, { onDelete: 'set null' }),
		/** Snapshot of the table name so the ticket still reads right after a table is retired. */
		tableLabel: text('table_label'),
		reservationId: uuid('reservation_id').references(() => diningReservations.id, { onDelete: 'set null' }),
		/** An in-house guest's stay, for traceability (booking code + guest name on staff screens). */
		bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
		guestName: text('guest_name'),
		guestPhone: text('guest_phone'),
		guestEmail: text('guest_email'),
		remarks: text('remarks'),
		/** 'staff' (taken at the venue/cashier) or 'online' (guest ordered). */
		source: text('source').notNull().default('staff'),
		totalCentavos: bigint('total_centavos', { mode: 'number' }).notNull(),
		vatCentavos: bigint('vat_centavos', { mode: 'number' }).notNull().default(0),
		// --- payment (set when paid at the cashier) ---
		businessDate: date('business_date', { mode: 'string' }),
		paymentMethod: paymentMethod('payment_method'),
		tenderedCentavos: bigint('tendered_centavos', { mode: 'number' }),
		changeCentavos: bigint('change_centavos', { mode: 'number' }).notNull().default(0),
		cashAccountId: uuid('cash_account_id').references(() => cashAccounts.id, { onDelete: 'restrict' }),
		shiftId: uuid('shift_id').references(() => cashierShifts.id, { onDelete: 'set null' }),
		/** No FK, same generic-link convention as `cash_movements.sourceId`. */
		cashMovementId: uuid('cash_movement_id'),
		paidAt: timestamp('paid_at', { withTimezone: true }),
		paidByUserId: uuid('paid_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		acceptedAt: timestamp('accepted_at', { withTimezone: true }),
		readyAt: timestamp('ready_at', { withTimezone: true }),
		servedAt: timestamp('served_at', { withTimezone: true }),
		cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
		cancelReason: text('cancel_reason'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('dining_orders_code_uq').on(t.hotelId, t.code),
		index('dining_orders_hotel_status_idx').on(t.hotelId, t.status),
		index('dining_orders_hotel_date_idx').on(t.hotelId, t.businessDate),
		index('dining_orders_venue_created_idx').on(t.hotelId, t.diningItemId, t.createdAt)
	]
);

export const diningOrderItems = pgTable(
	'dining_order_items',
	{
		id: pk(),
		orderId: uuid('order_id')
			.notNull()
			.references(() => diningOrders.id, { onDelete: 'cascade' }),
		/** Null once the menu item is deleted; the snapshot below keeps the line readable. */
		menuItemId: uuid('menu_item_id').references(() => diningMenuItems.id, { onDelete: 'set null' }),
		name: text('name').notNull(),
		/** Snapshotted so sales can be reported by station even if a dish is later re-tagged. */
		stationId: uuid('station_id').references(() => diningStations.id, { onDelete: 'set null' }),
		stationName: text('station_name'),
		quantity: integer('quantity').notNull(),
		unitPriceCentavos: bigint('unit_price_centavos', { mode: 'number' }).notNull(),
		/** Sum of this line's add-on prices, per unit. */
		addonsCentavos: bigint('addons_centavos', { mode: 'number' }).notNull().default(0),
		lineTotalCentavos: bigint('line_total_centavos', { mode: 'number' }).notNull(),
		vatCentavos: bigint('vat_centavos', { mode: 'number' }).notNull().default(0),
		remarks: text('remarks'),
		sortOrder: integer('sort_order').notNull().default(0)
	},
	(t) => [index('dining_order_items_order_idx').on(t.orderId), index('dining_order_items_menu_idx').on(t.menuItemId)]
);

export const diningOrderItemAddons = pgTable(
	'dining_order_item_addons',
	{
		id: pk(),
		orderItemId: uuid('order_item_id')
			.notNull()
			.references(() => diningOrderItems.id, { onDelete: 'cascade' }),
		addonId: uuid('addon_id').references(() => diningAddons.id, { onDelete: 'set null' }),
		name: text('name').notNull(),
		priceCentavos: bigint('price_centavos', { mode: 'number' }).notNull().default(0)
	},
	(t) => [index('dining_order_item_addons_item_idx').on(t.orderItemId)]
);

export type DiningOrder = typeof diningOrders.$inferSelect;
export type DiningOrderItem = typeof diningOrderItems.$inferSelect;
export type DiningOrderStatus = (typeof diningOrderStatus.enumValues)[number];
export type DiningOrderType = (typeof diningOrderType.enumValues)[number];
