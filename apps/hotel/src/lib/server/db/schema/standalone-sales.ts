import { relations } from 'drizzle-orm';
import { bigint, date, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk } from './_shared';
import { hotels } from './hotels';
import { users } from './auth';
import { paymentMethod } from './bookings';
import { cashAccounts, cashierShifts } from './finance';
import { amenityItems } from './folio';

/**
 * A sale with no booking behind it — a walk-in buying something from the sellable
 * catalog (`amenity_items`) with no room/hall stay to charge it to. Posts straight
 * to cash-in (`cash_movements`, category `incidental_sale`) instead of a folio —
 * the "standalone" half of the amenity-sale design in the original phased plan
 * that was never built alongside the folio-linked half. No guest record required.
 */
export const standaloneSales = pgTable(
	'standalone_sales',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		businessDate: date('business_date', { mode: 'string' }).notNull(),
		method: paymentMethod('method').notNull(),
		cashAccountId: uuid('cash_account_id')
			.notNull()
			.references(() => cashAccounts.id, { onDelete: 'restrict' }),
		/** The cashier shift this sale counted against, for cash — same drawer
		 *  accountability as any other cash sale. Null for a non-cash method. */
		shiftId: uuid('shift_id').references(() => cashierShifts.id, { onDelete: 'set null' }),
		totalCentavos: bigint('total_centavos', { mode: 'number' }).notNull(),
		/** Cash only: what the walk-in handed over; `changeCentavos = tenderedCentavos - totalCentavos`.
		 *  Same convention as `payments.tenderedCentavos`/`changeCentavos`. */
		tenderedCentavos: bigint('tendered_centavos', { mode: 'number' }),
		changeCentavos: bigint('change_centavos', { mode: 'number' }).notNull().default(0),
		/** No FK — same generic-link convention as `cash_movements.sourceId`. */
		cashMovementId: uuid('cash_movement_id').notNull(),
		soldByUserId: uuid('sold_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(t) => [index('standalone_sales_hotel_date_idx').on(t.hotelId, t.businessDate)]
);

export const standaloneSaleItems = pgTable(
	'standalone_sale_items',
	{
		id: pk(),
		saleId: uuid('sale_id')
			.notNull()
			.references(() => standaloneSales.id, { onDelete: 'cascade' }),
		/** Nullable — an ad-hoc line not in the catalog is still allowed. */
		amenityItemId: uuid('amenity_item_id').references(() => amenityItems.id, { onDelete: 'set null' }),
		/** Snapshotted at sale time — stays accurate even if the catalog item is later
		 *  renamed or deleted. */
		description: text('description').notNull(),
		quantity: integer('quantity').notNull(),
		unitPriceCentavos: bigint('unit_price_centavos', { mode: 'number' }).notNull(),
		lineTotalCentavos: bigint('line_total_centavos', { mode: 'number' }).notNull()
	},
	(t) => [index('standalone_sale_items_sale_idx').on(t.saleId)]
);

export const standaloneSalesRelations = relations(standaloneSales, ({ one, many }) => ({
	hotel: one(hotels, { fields: [standaloneSales.hotelId], references: [hotels.id] }),
	items: many(standaloneSaleItems)
}));

export const standaloneSaleItemsRelations = relations(standaloneSaleItems, ({ one }) => ({
	sale: one(standaloneSales, { fields: [standaloneSaleItems.saleId], references: [standaloneSales.id] }),
	amenityItem: one(amenityItems, {
		fields: [standaloneSaleItems.amenityItemId],
		references: [amenityItems.id]
	})
}));

export type StandaloneSale = typeof standaloneSales.$inferSelect;
export type StandaloneSaleItem = typeof standaloneSaleItems.$inferSelect;
