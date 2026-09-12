import { relations } from 'drizzle-orm';
import {
	bigint,
	date,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	time,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { createdAt, pk, updatedAt } from './_shared';
import { hotels } from './hotels';
import { users } from './auth';
import { ratePlans, roomTypes } from './inventory';
import { functionHalls } from './function-halls';
import { orders } from './orders';

/** A guest's contact record for a stay. Not an auth account — guests never log in. */
export const guests = pgTable(
	'guests',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		fullName: text('full_name').notNull(),
		email: text('email').notNull(),
		phone: text('phone'),
		specialRequests: text('special_requests'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('guests_hotel_idx').on(t.hotelId),
		index('guests_hotel_email_idx').on(t.hotelId, t.email)
	]
);

export const bookingStatus = pgEnum('booking_status', [
	'pending_payment',
	'confirmed',
	'checked_in',
	'checked_out',
	'cancelled',
	'no_show'
]);

/**
 * One room stay, always under an `orders` row (the thing that's actually paid
 * for — see `orders.ts`). Bill amounts are snapshotted at creation from
 * `pricing.ts`'s `priceStay` — never recomputed live, so a later rate change
 * can't alter a guest's already-booked total. Guest identity, payment/checkout
 * session, and access token live on the parent order now, not here — a stay is
 * one line item under a checkout, not a checkout by itself.
 */
export const bookings = pgTable(
	'bookings',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		orderId: uuid('order_id')
			.notNull()
			.references(() => orders.id, { onDelete: 'cascade' }),
		checkIn: date('check_in', { mode: 'string' }).notNull(),
		checkOut: date('check_out', { mode: 'string' }).notNull(),
		occupancy: integer('occupancy').notNull(),
		status: bookingStatus('status').notNull().default('pending_payment'),
		currency: text('currency').notNull().default('PHP'),
		subtotalCentavos: bigint('subtotal_centavos', { mode: 'number' }).notNull(),
		feesCentavos: bigint('fees_centavos', { mode: 'number' }).notNull(),
		vatCentavos: bigint('vat_centavos', { mode: 'number' }).notNull(),
		totalCentavos: bigint('total_centavos', { mode: 'number' }).notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('bookings_hotel_idx').on(t.hotelId), index('bookings_order_idx').on(t.orderId)]
);

/**
 * The room(s) booked. Still one row per `bookings` row (one room-type/rate-plan
 * per booking), but `quantity` now reflects how many rooms of that type/plan the
 * guest chose in the storefront's Rooms & Guests popover — no longer always 1.
 * `bookings.*Centavos` is already scaled by `quantity` (see `pricing-utils.ts`'s
 * `scaleRoomPrice`, applied identically at display time and at order-creation
 * time), so this column and the booking's own price snapshot never disagree.
 * (An *order* may still carry several `bookings` rows of different room
 * types/dates, plus `hallBookings` — that's the cart `orders.ts` exists for;
 * this table's own one-row-per-booking rule is a separate, narrower constraint
 * that's still in force. Editing quantity on an already-added cart line, or
 * mixing different quantities of different room types in one cart, is still
 * out of scope — the storefront's room count is one global value applied to
 * whichever line is next added to the cart.)
 */
export const bookingRooms = pgTable(
	'booking_rooms',
	{
		id: pk(),
		bookingId: uuid('booking_id')
			.notNull()
			.references(() => bookings.id, { onDelete: 'cascade' }),
		roomTypeId: uuid('room_type_id')
			.notNull()
			.references(() => roomTypes.id, { onDelete: 'restrict' }),
		ratePlanId: uuid('rate_plan_id')
			.notNull()
			.references(() => ratePlans.id, { onDelete: 'restrict' }),
		quantity: integer('quantity').notNull().default(1),
		createdAt: createdAt()
	},
	(t) => [
		index('booking_rooms_booking_idx').on(t.bookingId),
		index('booking_rooms_room_type_idx').on(t.roomTypeId)
	]
);

export const bookingStatusHistory = pgTable(
	'booking_status_history',
	{
		id: pk(),
		bookingId: uuid('booking_id')
			.notNull()
			.references(() => bookings.id, { onDelete: 'cascade' }),
		fromStatus: bookingStatus('from_status'),
		toStatus: bookingStatus('to_status').notNull(),
		note: text('note'),
		createdAt: createdAt()
	},
	(t) => [index('booking_status_history_booking_idx').on(t.bookingId)]
);

export const hallBookingStatus = pgEnum('hall_booking_status', [
	'pending_payment',
	'confirmed',
	'completed',
	'cancelled'
]);

/**
 * One hourly function-hall reservation under an order — the booked-instance
 * counterpart to `functionHalls` (see `function-halls.ts`), kept in this file
 * to mirror how `bookingRooms`/`bookingStatusHistory` sit next to `bookings`
 * rather than in `inventory.ts`. Unlike `bookingRooms`, this carries its own
 * full price snapshot: a hall line prices itself independently (see
 * `pricing.ts`'s `priceEventHall`) and `orders.*Centavos` is just the sum
 * across every line under the order.
 */
export const hallBookings = pgTable(
	'hall_bookings',
	{
		id: pk(),
		orderId: uuid('order_id')
			.notNull()
			.references(() => orders.id, { onDelete: 'cascade' }),
		functionHallId: uuid('function_hall_id')
			.notNull()
			.references(() => functionHalls.id, { onDelete: 'restrict' }),
		eventDate: date('event_date', { mode: 'string' }).notNull(),
		startTime: time('start_time').notNull(),
		endTime: time('end_time').notNull(),
		eventType: text('event_type').notNull(),
		guestCount: integer('guest_count').notNull(),
		status: hallBookingStatus('status').notNull().default('pending_payment'),
		currency: text('currency').notNull().default('PHP'),
		subtotalCentavos: bigint('subtotal_centavos', { mode: 'number' }).notNull(),
		feesCentavos: bigint('fees_centavos', { mode: 'number' }).notNull(),
		vatCentavos: bigint('vat_centavos', { mode: 'number' }).notNull(),
		totalCentavos: bigint('total_centavos', { mode: 'number' }).notNull(),
		createdAt: createdAt()
	},
	(t) => [
		index('hall_bookings_order_idx').on(t.orderId),
		index('hall_bookings_hall_idx').on(t.functionHallId, t.eventDate)
	]
);

export const hallBookingStatusHistory = pgTable(
	'hall_booking_status_history',
	{
		id: pk(),
		hallBookingId: uuid('hall_booking_id')
			.notNull()
			.references(() => hallBookings.id, { onDelete: 'cascade' }),
		fromStatus: hallBookingStatus('from_status'),
		toStatus: hallBookingStatus('to_status').notNull(),
		note: text('note'),
		createdAt: createdAt()
	},
	(t) => [index('hall_booking_status_history_hall_booking_idx').on(t.hallBookingId)]
);

export const paymentStatus = pgEnum('payment_status', ['pending', 'paid', 'failed']);

/**
 * How money actually changed hands at the desk (or online). `paymongo` = the
 * guest-facing hosted checkout; everything else is entered by a cashier. Defined
 * here rather than in `finance.ts` so `payments` can use it without a schema
 * import cycle (`finance.ts` → `bookings.ts`, never the reverse).
 */
export const paymentMethod = pgEnum('payment_method', [
	'cash',
	'card',
	'gcash',
	'maya',
	'bank_transfer',
	'cheque',
	'paymongo',
	'house_use'
]);

/** What a payment is *for* on the folio — a pre-arrival deposit, a partial/full settlement,
 *  or a money-out refund line (`amountCentavos` is still stored positive; `status`/reporting
 *  treat `refund` as an outflow). */
export const paymentPurpose = pgEnum('payment_purpose', [
	'deposit',
	'settlement',
	'balance',
	'refund'
]);

export const payments = pgTable(
	'payments',
	{
		id: pk(),
		orderId: uuid('order_id')
			.notNull()
			.references(() => orders.id, { onDelete: 'cascade' }),
		provider: text('provider').notNull().default('paymongo'),
		paymongoCheckoutSessionId: text('paymongo_checkout_session_id'),
		paymongoPaymentId: text('paymongo_payment_id'),
		/** Unique per PayMongo webhook event id — the idempotency guard against retried deliveries. */
		paymongoEventId: text('paymongo_event_id'),
		status: paymentStatus('status').notNull().default('pending'),
		amountCentavos: bigint('amount_centavos', { mode: 'number' }).notNull(),
		currency: text('currency').notNull().default('PHP'),
		/** Raw PayMongo event payload, kept for audit/debugging. */
		rawPayload: jsonb('raw_payload'),
		paidAt: timestamp('paid_at', { withTimezone: true }),
		createdAt: createdAt(),

		// --- Cashier / finance fields (added with the front-desk cashier + Finance module) ---
		/** Richer than `provider`: the actual tender. Backfilled from `provider` for old rows. */
		method: paymentMethod('method').notNull().default('cash'),
		purpose: paymentPurpose('purpose').notNull().default('settlement'),
		/** The folio this payment was taken against. Plain uuid (no FK) to avoid a
		 *  `bookings.ts` ↔ `folio.ts` schema import cycle — integrity is enforced in
		 *  `lib/server/finance/payments.ts`. */
		folioId: uuid('folio_id'),
		/** Cash account that received the money (`cash_accounts.id`). Plain uuid — see `folioId`. */
		cashAccountId: uuid('cash_account_id'),
		/** Cashier shift it was rung on (`cashier_shifts.id`), when there was one. Plain uuid — see `folioId`. */
		shiftId: uuid('shift_id'),
		/** Cash only: what the guest handed over; `changeCentavos = tenderedCentavos - amountCentavos`. */
		tenderedCentavos: bigint('tendered_centavos', { mode: 'number' }),
		changeCentavos: bigint('change_centavos', { mode: 'number' }).notNull().default(0),
		/** Card approval code / e-wallet reference / cheque number. */
		referenceNo: text('reference_no'),
		bankName: text('bank_name'),
		chequeDate: date('cheque_date', { mode: 'string' }),
		recordedByUserId: uuid('recorded_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		/** Soft-void, mirrors `folio_charges` — excluded from balances/reports but kept for audit. */
		voidedAt: timestamp('voided_at', { withTimezone: true }),
		voidedByUserId: uuid('voided_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		voidReason: text('void_reason'),

		// --- Refund tracking (cancellation flow) ---
		/** On a `purpose: 'refund'` row: the original payment it refunds. Plain uuid
		 *  (no self-referential FK) — see `folioId`'s own comment for why. */
		refundsPaymentId: uuid('refunds_payment_id'),
		/** PayMongo's own refund object id (`ref_...`), set when the refund was actually
		 *  issued via their Refunds API — lets the webhook match `payment.refund_updated` /
		 *  `payment.refunded` events back to this row. */
		paymongoRefundId: text('paymongo_refund_id')
	},
	(t) => [
		index('payments_order_idx').on(t.orderId),
		uniqueIndex('payments_paymongo_event_idx').on(t.paymongoEventId),
		index('payments_folio_idx').on(t.folioId),
		index('payments_shift_idx').on(t.shiftId),
		index('payments_refunds_payment_idx').on(t.refundsPaymentId),
		index('payments_paymongo_refund_idx').on(t.paymongoRefundId)
	]
);

export const guestsRelations = relations(guests, ({ one, many }) => ({
	hotel: one(hotels, { fields: [guests.hotelId], references: [hotels.id] }),
	orders: many(orders)
}));

export const bookingsRelations = relations(bookings, ({ one, many }) => ({
	hotel: one(hotels, { fields: [bookings.hotelId], references: [hotels.id] }),
	order: one(orders, { fields: [bookings.orderId], references: [orders.id] }),
	rooms: many(bookingRooms),
	statusHistory: many(bookingStatusHistory)
}));

export const bookingRoomsRelations = relations(bookingRooms, ({ one }) => ({
	booking: one(bookings, { fields: [bookingRooms.bookingId], references: [bookings.id] }),
	roomType: one(roomTypes, { fields: [bookingRooms.roomTypeId], references: [roomTypes.id] }),
	ratePlan: one(ratePlans, { fields: [bookingRooms.ratePlanId], references: [ratePlans.id] })
}));

export const bookingStatusHistoryRelations = relations(bookingStatusHistory, ({ one }) => ({
	booking: one(bookings, { fields: [bookingStatusHistory.bookingId], references: [bookings.id] })
}));

export const hallBookingsRelations = relations(hallBookings, ({ one, many }) => ({
	order: one(orders, { fields: [hallBookings.orderId], references: [orders.id] }),
	functionHall: one(functionHalls, {
		fields: [hallBookings.functionHallId],
		references: [functionHalls.id]
	}),
	statusHistory: many(hallBookingStatusHistory)
}));

export const hallBookingStatusHistoryRelations = relations(hallBookingStatusHistory, ({ one }) => ({
	hallBooking: one(hallBookings, {
		fields: [hallBookingStatusHistory.hallBookingId],
		references: [hallBookings.id]
	})
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
	order: one(orders, { fields: [payments.orderId], references: [orders.id] })
}));

export type Guest = typeof guests.$inferSelect;
export type NewGuest = typeof guests.$inferInsert;
export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
export type BookingRoom = typeof bookingRooms.$inferSelect;
export type BookingStatusHistoryRow = typeof bookingStatusHistory.$inferSelect;
export type HallBooking = typeof hallBookings.$inferSelect;
export type NewHallBooking = typeof hallBookings.$inferInsert;
export type HallBookingStatusHistoryRow = typeof hallBookingStatusHistory.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
