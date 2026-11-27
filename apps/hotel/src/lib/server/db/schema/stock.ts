import { sql } from 'drizzle-orm';
import { bigint, boolean, check, date, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, pk, updatedAt } from './_shared';
import { users } from './auth';
import { diningAddons, diningMenuItems, diningOrders } from './dining';
import { bookings } from './bookings';
import { roomTypes } from './inventory';
import { expenses, vendors } from './finance';
import { hotels } from './hotels';

/**
 * Stock (inventory of physical goods) — not to be confused with `inventory.ts`, which is
 * room types and rates. No prices: this only answers "how much do we have, and where did it go".
 *
 * Quantities are integer **thousandths of the item's base unit** (`*_milli` columns), the
 * same idea as centavos: 1 kg rice = 1_000_000 (g × 1000), half a lemon = 500 (pcs × 1000).
 * Conversions live in `$lib/stock-units.ts`.
 */
export const stockDepartment = pgEnum('stock_department', ['dining', 'front_desk', 'housekeeping']);

/** `consumable` is used up (soap, rice). `reusable` is only counted and audited (towels, sheets). */
export const stockKind = pgEnum('stock_kind', ['consumable', 'reusable']);

/** Base unit every quantity of an item is stored in. kg/oz → g, L/fl oz/tsp → ml, dozen → pcs. */
export const stockUnit = pgEnum('stock_unit', ['g', 'ml', 'pcs']);

export const stockItems = pgTable(
	'stock_items',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		department: stockDepartment('department').notNull(),
		kind: stockKind('kind').notNull().default('consumable'),
		unit: stockUnit('unit').notNull(),
		/** At or below this on-hand quantity the item shows as low. Null = never flagged. */
		reorderLevelMilli: bigint('reorder_level_milli', { mode: 'number' }),
		isActive: boolean('is_active').notNull().default(true),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: deletedAt()
	},
	(t) => [
		index('stock_items_hotel_idx').on(t.hotelId, t.department),
		uniqueIndex('stock_items_hotel_name_uq').on(t.hotelId, sql`lower(${t.name})`).where(sql`${t.deletedAt} IS NULL`)
	]
);

/**
 * `restock` / `adjust_in` add stock and are the FIFO batches (`qtyRemainingMilli` set).
 * `waste` / `adjust_out` / `order` draw down oldest-batch-first, one row per batch drawn from.
 * `order_reverse` puts a cancelled dining order's ingredients back (see `syncDiningOrderStock`).
 * `checkin_kit` is the guest amenities handed out at a room check-in.
 * `restock_void` takes back an untouched batch when its supplier receipt (restock) is voided.
 */
export const stockMovementType = pgEnum('stock_movement_type', [
	'restock',
	'adjust_in',
	'waste',
	'adjust_out',
	'order',
	'order_reverse',
	'checkin_kit',
	'restock_void'
]);

/**
 * Append-only stock ledger, modelled on WashSuite's `inventory_movements`. On hand is
 * `SUM(qty_milli)` per item — never a stored running total. A draw-down that outruns the
 * batches is still recorded (unbatched, `consumedFromId` null) so stock may go negative:
 * a wrong count must never block a sale.
 */
export const stockMovements = pgTable(
	'stock_movements',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		itemId: uuid('item_id')
			.notNull()
			.references(() => stockItems.id, { onDelete: 'cascade' }),
		type: stockMovementType('type').notNull(),
		/** Signed: + into stock, − out of stock. */
		qtyMilli: bigint('qty_milli', { mode: 'number' }).notNull(),
		/** Batches only: how much of this batch is not yet drawn down. */
		qtyRemainingMilli: bigint('qty_remaining_milli', { mode: 'number' }),
		/** Draw-downs only: the batch this row came out of. */
		consumedFromId: uuid('consumed_from_id').references((): AnyPgColumn => stockMovements.id, { onDelete: 'set null' }),
		/** Batches only, optional. */
		expiresOn: date('expires_on'),
		/** How a restock was bought, kept for reference: (packCount + packBonus) × packSize = qty. */
		packCount: integer('pack_count'),
		packBonus: integer('pack_bonus'),
		packSizeMilli: bigint('pack_size_milli', { mode: 'number' }),
		/** Supplier / delivery ref on a restock; the reason on waste or an adjustment. */
		note: text('note'),
		/** The dining order an `order` / `order_reverse` row belongs to. */
		diningOrderId: uuid('dining_order_id').references(() => diningOrders.id, { onDelete: 'set null' }),
		/** The room booking a `checkin_kit` row was handed out for. */
		bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
		/** The supplier receipt a `restock` / `restock_void` row belongs to. */
		restockId: uuid('restock_id').references((): AnyPgColumn => stockRestocks.id, { onDelete: 'set null' }),
		/** The stock count an `adjust_in` / `adjust_out` row was posted from. */
		countId: uuid('count_id').references((): AnyPgColumn => stockCounts.id, { onDelete: 'set null' }),
		createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('stock_movements_item_idx').on(t.itemId, t.createdAt),
		index('stock_movements_hotel_idx').on(t.hotelId, t.createdAt),
		index('stock_movements_dining_order_idx').on(t.diningOrderId),
		index('stock_movements_booking_idx').on(t.bookingId),
		index('stock_movements_restock_idx').on(t.restockId),
		index('stock_movements_open_batch_idx').on(t.itemId, t.createdAt).where(sql`${t.qtyRemainingMilli} > 0`)
	]
);

/**
 * What one serving of a menu item — or one pick of an add-on — takes out of stock. Exactly one of
 * `menuItemId` / `addonId` is set. An order line deducts `qtyMilli × line quantity` for its dish
 * and for each add-on chosen on it.
 */
export const stockRecipeLines = pgTable(
	'stock_recipe_lines',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		menuItemId: uuid('menu_item_id').references(() => diningMenuItems.id, { onDelete: 'cascade' }),
		addonId: uuid('addon_id').references(() => diningAddons.id, { onDelete: 'cascade' }),
		stockItemId: uuid('stock_item_id')
			.notNull()
			.references(() => stockItems.id, { onDelete: 'cascade' }),
		qtyMilli: bigint('qty_milli', { mode: 'number' }).notNull()
	},
	(t) => [
		check('stock_recipe_lines_one_owner', sql`(${t.menuItemId} IS NULL) <> (${t.addonId} IS NULL)`),
		check('stock_recipe_lines_qty_positive', sql`${t.qtyMilli} > 0`),
		uniqueIndex('stock_recipe_lines_menu_item_uq').on(t.menuItemId, t.stockItemId),
		uniqueIndex('stock_recipe_lines_addon_uq').on(t.addonId, t.stockItemId),
		index('stock_recipe_lines_hotel_idx').on(t.hotelId)
	]
);

/** A kit line counts once per room, or once per guest (booked occupancy). */
export const stockKitBasis = pgEnum('stock_kit_basis', ['room', 'guest']);

/**
 * A room type's default guest-amenity kit, pre-filled on the check-in form (staff can change it
 * there). Empty = no kit: check-in moves no stock.
 */
export const stockCheckinKitLines = pgTable(
	'stock_checkin_kit_lines',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		roomTypeId: uuid('room_type_id')
			.notNull()
			.references(() => roomTypes.id, { onDelete: 'cascade' }),
		stockItemId: uuid('stock_item_id')
			.notNull()
			.references(() => stockItems.id, { onDelete: 'cascade' }),
		qtyMilli: bigint('qty_milli', { mode: 'number' }).notNull(),
		per: stockKitBasis('per').notNull().default('room')
	},
	(t) => [
		check('stock_checkin_kit_lines_qty_positive', sql`${t.qtyMilli} > 0`),
		uniqueIndex('stock_checkin_kit_lines_uq').on(t.roomTypeId, t.stockItemId),
		index('stock_checkin_kit_lines_hotel_idx').on(t.hotelId)
	]
);

/**
 * One supplier receipt encoded in Inventory → Restock: its lines are `restock` movements (FIFO
 * batches, `restockId` set) and its total becomes one expense in Finance, created in the same
 * transaction and paid later by Finance. No per-line prices: the receipt's total is the cost.
 */
export const stockRestocks = pgTable(
	'stock_restocks',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		receiptDate: date('receipt_date', { mode: 'string' }).notNull(),
		vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
		/** One-off supplier typed on the receipt; set only when `vendorId` is null. */
		vendorName: text('vendor_name'),
		/** The supplier's OR / invoice / DR number. */
		receiptNo: text('receipt_no'),
		totalCentavos: bigint('total_centavos', { mode: 'number' }).notNull(),
		/** `/uploads/<hotelId>/<file>` — the receipt photo, also attached to the expense. */
		attachmentUrl: text('attachment_url'),
		note: text('note'),
		expenseId: uuid('expense_id').references(() => expenses.id, { onDelete: 'set null' }),
		createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		voidedAt: timestamp('voided_at', { withTimezone: true }),
		voidedBy: uuid('voided_by').references(() => users.id, { onDelete: 'set null' }),
		voidReason: text('void_reason')
	},
	(t) => [
		index('stock_restocks_hotel_idx').on(t.hotelId, t.receiptDate),
		index('stock_restocks_expense_idx').on(t.expenseId),
		check('stock_restocks_total_positive', sql`${t.totalCentavos} > 0`)
	]
);

export const stockCountStatus = pgEnum('stock_count_status', ['open', 'finished']);

/**
 * A stock take: staff count what is really on the shelf for one department (or all) and, on
 * finish, each difference is posted as a correction. Linens are audited this way. One open count
 * per hotel at a time.
 */
export const stockCounts = pgTable(
	'stock_counts',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		/** Null = every department. */
		department: stockDepartment('department'),
		status: stockCountStatus('status').notNull().default('open'),
		note: text('note'),
		startedBy: uuid('started_by').references(() => users.id, { onDelete: 'set null' }),
		startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
		finishedBy: uuid('finished_by').references(() => users.id, { onDelete: 'set null' }),
		finishedAt: timestamp('finished_at', { withTimezone: true })
	},
	(t) => [
		index('stock_counts_hotel_idx').on(t.hotelId, t.startedAt),
		uniqueIndex('stock_counts_one_open_uq').on(t.hotelId).where(sql`${t.status} = 'open'`)
	]
);

export const stockCountLines = pgTable(
	'stock_count_lines',
	{
		id: pk(),
		countId: uuid('count_id')
			.notNull()
			.references(() => stockCounts.id, { onDelete: 'cascade' }),
		itemId: uuid('item_id')
			.notNull()
			.references(() => stockItems.id, { onDelete: 'cascade' }),
		/** What staff found. Null = not counted (left alone on finish). */
		countedMilli: bigint('counted_milli', { mode: 'number' }),
		/** Why it differs — lost, damaged, taken by a guest… Required on finish when it does. */
		reason: text('reason'),
		/** On hand just before the count was posted, and the correction posted. Set on finish. */
		expectedMilli: bigint('expected_milli', { mode: 'number' }),
		varianceMilli: bigint('variance_milli', { mode: 'number' })
	},
	(t) => [uniqueIndex('stock_count_lines_uq').on(t.countId, t.itemId)]
);

export type StockItem = typeof stockItems.$inferSelect;
export type StockMovement = typeof stockMovements.$inferSelect;
