import { relations, sql } from 'drizzle-orm';
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
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, pk, updatedAt } from './_shared';
import { hotels } from './hotels';
import { users } from './auth';
import { folios } from './folio';
import { bookings, hallBookings, payments, paymentMethod } from './bookings';

/**
 * Internal, per-hotel Finance (cash-basis). No chart of accounts / journal
 * entries here yet — that's Phase 5 / `@mm/finance-core`. This file is the
 * operational spine: where cash sits (`cash_accounts`), every peso that moves
 * (`cash_movements`), what the hotel spends (`expenses` & friends), who owes it
 * money (`receivables`), and the cashier/day controls (`cashier_shifts`,
 * `shift_events`, `day_closes`).
 *
 * Money is `bigint` centavos, PHP, same convention as the rest of the schema.
 */

// ---------------------------------------------------------------------------
// Cash accounts
// ---------------------------------------------------------------------------

export const cashAccountKind = pgEnum('cash_account_kind', [
	'cash_drawer', // a front-desk till a cashier shift opens against
	'petty_cash', // the manager's small-expense float
	'bank', // a real bank account
	'e_wallet', // GCash / Maya / etc.
	'undeposited' // holding account for online (PayMongo) receipts until a payout lands
]);

export const cashAccounts = pgTable(
	'cash_accounts',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		kind: cashAccountKind('kind').notNull(),
		/** Bank / e-wallet provider name, optional. */
		institution: text('institution'),
		/** Masked account / wallet number for reference, optional. */
		accountRef: text('account_ref'),
		openingBalanceCentavos: bigint('opening_balance_centavos', { mode: 'number' })
			.notNull()
			.default(0),
		/**
		 * Denormalized running balance = opening + every non-voided movement on this
		 * account. Maintained *inside the same transaction* as each movement by
		 * `lib/server/finance/cash.ts`'s `recordCashMovement` — never write it directly.
		 */
		currentBalanceCentavos: bigint('current_balance_centavos', { mode: 'number' })
			.notNull()
			.default(0),
		/** The one seeded "Undeposited Funds" account — cannot be deleted or renamed away. */
		isSystem: boolean('is_system').notNull().default(false),
		isActive: boolean('is_active').notNull().default(true),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: deletedAt()
	},
	(t) => [index('cash_accounts_hotel_idx').on(t.hotelId)]
);

// ---------------------------------------------------------------------------
// Cashier shifts
// ---------------------------------------------------------------------------

export const shiftStatus = pgEnum('cashier_shift_status', ['open', 'closed']);

export const cashierShifts = pgTable(
	'cashier_shifts',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		/** The drawer this shift controls. */
		cashAccountId: uuid('cash_account_id')
			.notNull()
			.references(() => cashAccounts.id, { onDelete: 'restrict' }),
		businessDate: date('business_date', { mode: 'string' }).notNull(),
		openedByUserId: uuid('opened_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
		openingFloatCentavos: bigint('opening_float_centavos', { mode: 'number' }).notNull().default(0),
		status: shiftStatus('status').notNull().default('open'),
		closedByUserId: uuid('closed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		closedAt: timestamp('closed_at', { withTimezone: true }),
		/** Physical cash counted at close. */
		countedCashCentavos: bigint('counted_cash_centavos', { mode: 'number' }),
		/** float + cash in − cash out − drops, computed at close. */
		expectedCashCentavos: bigint('expected_cash_centavos', { mode: 'number' }),
		/** counted − expected (negative = short). */
		varianceCentavos: bigint('variance_centavos', { mode: 'number' }),
		/** Optional bill/coin breakdown entered on the close screen: `{ "1000": 3, "500": 2, ... }`. */
		denominations: jsonb('denominations'),
		closeNotes: text('close_notes'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('cashier_shifts_hotel_idx').on(t.hotelId),
		index('cashier_shifts_drawer_idx').on(t.cashAccountId),
		// At most one open shift per drawer at a time.
		uniqueIndex('cashier_shifts_one_open_per_drawer')
			.on(t.cashAccountId)
			.where(sql`status = 'open'`)
	]
);

export const shiftEventKind = pgEnum('shift_event_kind', [
	'payout',
	'cash_drop',
	'pickup',
	'adjustment'
]);

/** A cash move during an open shift that isn't a guest payment: a petty payout, a
 *  mid-shift drop to the safe/bank, a float top-up, or a manual correction. Each
 *  also writes a matching `cash_movements` row. */
export const shiftEvents = pgTable(
	'shift_events',
	{
		id: pk(),
		shiftId: uuid('shift_id')
			.notNull()
			.references(() => cashierShifts.id, { onDelete: 'cascade' }),
		kind: shiftEventKind('kind').notNull(),
		amountCentavos: bigint('amount_centavos', { mode: 'number' }).notNull(),
		reason: text('reason'),
		recordedByUserId: uuid('recorded_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		createdAt: createdAt()
	},
	(t) => [index('shift_events_shift_idx').on(t.shiftId)]
);

// ---------------------------------------------------------------------------
// Cash movements — the canonical cash-basis ledger
// ---------------------------------------------------------------------------

export const cashDirection = pgEnum('cash_direction', ['in', 'out']);

export const cashCategory = pgEnum('cash_category', [
	'room_revenue',
	'hall_revenue',
	'incidental_sale',
	'deposit',
	'deposit_refund',
	'refund',
	'other_revenue',
	'expense',
	'payroll',
	'statutory_remittance',
	'bank_deposit',
	'transfer_in',
	'transfer_out',
	'owner_contribution',
	'owner_draw',
	'adjustment'
]);

export const cashCounterpartyType = pgEnum('cash_counterparty_type', [
	'guest',
	'vendor',
	'employee',
	'other'
]);

/**
 * Every peso in or out of any `cash_accounts` row. Written by the operational
 * action that caused it (a payment, an expense marked paid, a transfer, a shift
 * event) or entered by hand. `amountCentavos` is always positive; `direction`
 * carries the sign. Non-voided rows sum (with `cash_accounts.openingBalance`) to
 * `currentBalanceCentavos`.
 */
export const cashMovements = pgTable(
	'cash_movements',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		/** The hotel-timezone date this belongs to for day-close / daily reports. */
		businessDate: date('business_date', { mode: 'string' }).notNull(),
		occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
		direction: cashDirection('direction').notNull(),
		category: cashCategory('category').notNull(),
		cashAccountId: uuid('cash_account_id')
			.notNull()
			.references(() => cashAccounts.id, { onDelete: 'restrict' }),
		amountCentavos: bigint('amount_centavos', { mode: 'number' }).notNull(),
		counterpartyType: cashCounterpartyType('counterparty_type'),
		counterpartyName: text('counterparty_name'),
		counterpartyId: uuid('counterparty_id'),
		/** `payment | expense | transfer | shift_event | receivable_settlement | manual` — link back to the source doc. */
		sourceType: text('source_type').notNull().default('manual'),
		sourceId: uuid('source_id'),
		paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'set null' }),
		shiftId: uuid('shift_id').references(() => cashierShifts.id, { onDelete: 'set null' }),
		/** Pairs the two rows of a transfer (or a shift cash-drop). */
		transferGroupId: uuid('transfer_group_id'),
		memo: text('memo'),
		recordedByUserId: uuid('recorded_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		voidedAt: timestamp('voided_at', { withTimezone: true }),
		voidedByUserId: uuid('voided_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		voidReason: text('void_reason'),
		createdAt: createdAt()
	},
	(t) => [
		index('cash_movements_hotel_date_idx').on(t.hotelId, t.businessDate),
		index('cash_movements_account_idx').on(t.hotelId, t.cashAccountId),
		index('cash_movements_source_idx').on(t.sourceType, t.sourceId),
		index('cash_movements_shift_idx').on(t.shiftId)
	]
);

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export const expenseGroup = pgEnum('expense_group', [
	'cogs',
	'utilities',
	'payroll',
	'supplies',
	'repairs',
	'marketing',
	'commissions',
	'taxes_licenses',
	'rent',
	'admin',
	'other'
]);

export const expenseCategories = pgTable(
	'expense_categories',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		group: expenseGroup('group').notNull().default('other'),
		isActive: boolean('is_active').notNull().default(true),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: deletedAt()
	},
	(t) => [index('expense_categories_hotel_idx').on(t.hotelId)]
);

export const vendors = pgTable(
	'vendors',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		tin: text('tin'),
		address: text('address'),
		contactName: text('contact_name'),
		contactPhone: text('contact_phone'),
		contactEmail: text('contact_email'),
		isActive: boolean('is_active').notNull().default(true),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: deletedAt()
	},
	(t) => [index('vendors_hotel_idx').on(t.hotelId)]
);

export const expenseStatus = pgEnum('expense_status', ['draft', 'approved', 'paid', 'void']);

export const recurringCadence = pgEnum('recurring_cadence', [
	'weekly',
	'monthly',
	'quarterly',
	'annually'
]);

export const recurringExpenses = pgTable(
	'recurring_expenses',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		categoryId: uuid('category_id')
			.notNull()
			.references(() => expenseCategories.id, { onDelete: 'restrict' }),
		vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
		description: text('description').notNull(),
		amountCentavos: bigint('amount_centavos', { mode: 'number' }).notNull(),
		isVatable: boolean('is_vatable').notNull().default(false),
		cadence: recurringCadence('cadence').notNull(),
		/** Day-of-month (monthly/quarterly/annually) or day-of-week 0–6 (weekly) anchor. */
		anchorDay: integer('anchor_day').notNull().default(1),
		nextDueOn: date('next_due_on', { mode: 'string' }).notNull(),
		isActive: boolean('is_active').notNull().default(true),
		createdByUserId: uuid('created_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: deletedAt()
	},
	(t) => [index('recurring_expenses_hotel_idx').on(t.hotelId)]
);

export const expenses = pgTable(
	'expenses',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		expenseDate: date('expense_date', { mode: 'string' }).notNull(),
		categoryId: uuid('category_id')
			.notNull()
			.references(() => expenseCategories.id, { onDelete: 'restrict' }),
		vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
		description: text('description').notNull(),
		/** The vendor's own invoice / OR number. */
		vendorInvoiceNo: text('vendor_invoice_no'),
		grossCentavos: bigint('gross_centavos', { mode: 'number' }).notNull(),
		/** Input VAT portion of `grossCentavos` (creditable) — 0 when not VAT-registered / non-VAT purchase. */
		inputVatCentavos: bigint('input_vat_centavos', { mode: 'number' }).notNull().default(0),
		/** grossCentavos − inputVatCentavos, stored for reporting convenience. */
		netOfVatCentavos: bigint('net_of_vat_centavos', { mode: 'number' }).notNull(),
		isVatable: boolean('is_vatable').notNull().default(false),
		/** Expanded withholding tax the hotel must remit on the vendor's behalf (memo only, cash-basis). */
		withholdingTaxCentavos: bigint('withholding_tax_centavos', { mode: 'number' })
			.notNull()
			.default(0),
		status: expenseStatus('status').notNull().default('draft'),
		paidFromAccountId: uuid('paid_from_account_id').references(() => cashAccounts.id, {
			onDelete: 'set null'
		}),
		paidAt: timestamp('paid_at', { withTimezone: true }),
		paymentMethod: paymentMethod('payment_method'),
		paymentReferenceNo: text('payment_reference_no'),
		/** `/uploads/<hotelId>/<file>` — receipt/invoice scan, via `lib/server/uploads.ts`. */
		attachmentUrl: text('attachment_url'),
		notes: text('notes'),
		createdByUserId: uuid('created_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		approvedByUserId: uuid('approved_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		approvedAt: timestamp('approved_at', { withTimezone: true }),
		recurringExpenseId: uuid('recurring_expense_id').references(() => recurringExpenses.id, {
			onDelete: 'set null'
		}),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: deletedAt()
	},
	(t) => [
		index('expenses_hotel_date_idx').on(t.hotelId, t.expenseDate),
		index('expenses_status_idx').on(t.hotelId, t.status)
	]
);

// ---------------------------------------------------------------------------
// Accounts receivable (city ledger)
// ---------------------------------------------------------------------------

export const receivableStatus = pgEnum('receivable_status', [
	'open',
	'partial',
	'settled',
	'written_off'
]);

/** A balance a guest / company still owes after they've left — created by the
 *  "charge to city ledger" manager override at checkout, collected later. */
export const receivables = pgTable(
	'receivables',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		folioId: uuid('folio_id').references(() => folios.id, { onDelete: 'set null' }),
		bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
		hallBookingId: uuid('hall_booking_id').references(() => hallBookings.id, {
			onDelete: 'set null'
		}),
		billToName: text('bill_to_name').notNull(),
		billToCompany: text('bill_to_company'),
		referenceNo: text('reference_no'),
		originalAmountCentavos: bigint('original_amount_centavos', { mode: 'number' }).notNull(),
		outstandingCentavos: bigint('outstanding_centavos', { mode: 'number' }).notNull(),
		status: receivableStatus('status').notNull().default('open'),
		openedByUserId: uuid('opened_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
		notes: text('notes'),
		settledAt: timestamp('settled_at', { withTimezone: true }),
		writtenOffByUserId: uuid('written_off_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		writeOffReason: text('write_off_reason'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('receivables_hotel_status_idx').on(t.hotelId, t.status)]
);

// ---------------------------------------------------------------------------
// Day close
// ---------------------------------------------------------------------------

export const dayCloses = pgTable(
	'day_closes',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		businessDate: date('business_date', { mode: 'string' }).notNull(),
		closedByUserId: uuid('closed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		closedAt: timestamp('closed_at', { withTimezone: true }).notNull().defaultNow(),
		/** Snapshot of the day's totals at close time (by category, by account, revenue by source, shift variance). */
		totals: jsonb('totals').notNull().default({}),
		notes: text('notes'),
		reopenedByUserId: uuid('reopened_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		reopenedAt: timestamp('reopened_at', { withTimezone: true }),
		createdAt: createdAt()
	},
	(t) => [uniqueIndex('day_closes_hotel_date_idx').on(t.hotelId, t.businessDate)]
);

// ---------------------------------------------------------------------------
// Finance settings (one row per hotel)
// ---------------------------------------------------------------------------

export const financeSettings = pgTable('finance_settings', {
	hotelId: uuid('hotel_id')
		.primaryKey()
		.references(() => hotels.id, { onDelete: 'cascade' }),
	defaultDrawerAccountId: uuid('default_drawer_account_id').references(() => cashAccounts.id, {
		onDelete: 'set null'
	}),
	defaultBankAccountId: uuid('default_bank_account_id').references(() => cashAccounts.id, {
		onDelete: 'set null'
	}),
	undepositedAccountId: uuid('undeposited_account_id').references(() => cashAccounts.id, {
		onDelete: 'set null'
	}),
	autoPostOnlinePayments: boolean('auto_post_online_payments').notNull().default(true),
	requireExpenseApproval: boolean('require_expense_approval').notNull().default(true),
	lockOnDayClose: boolean('lock_on_day_close').notNull().default(true),
	requireOpenShiftForCashPayment: boolean('require_open_shift_for_cash_payment')
		.notNull()
		.default(true),
	createdAt: createdAt(),
	updatedAt: updatedAt()
});

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const cashAccountsRelations = relations(cashAccounts, ({ one, many }) => ({
	hotel: one(hotels, { fields: [cashAccounts.hotelId], references: [hotels.id] }),
	movements: many(cashMovements)
}));

export const cashMovementsRelations = relations(cashMovements, ({ one }) => ({
	hotel: one(hotels, { fields: [cashMovements.hotelId], references: [hotels.id] }),
	account: one(cashAccounts, {
		fields: [cashMovements.cashAccountId],
		references: [cashAccounts.id]
	}),
	payment: one(payments, { fields: [cashMovements.paymentId], references: [payments.id] }),
	shift: one(cashierShifts, { fields: [cashMovements.shiftId], references: [cashierShifts.id] })
}));

export const cashierShiftsRelations = relations(cashierShifts, ({ one, many }) => ({
	hotel: one(hotels, { fields: [cashierShifts.hotelId], references: [hotels.id] }),
	drawer: one(cashAccounts, {
		fields: [cashierShifts.cashAccountId],
		references: [cashAccounts.id]
	}),
	events: many(shiftEvents)
}));

export const shiftEventsRelations = relations(shiftEvents, ({ one }) => ({
	shift: one(cashierShifts, { fields: [shiftEvents.shiftId], references: [cashierShifts.id] })
}));

export const expensesRelations = relations(expenses, ({ one }) => ({
	hotel: one(hotels, { fields: [expenses.hotelId], references: [hotels.id] }),
	category: one(expenseCategories, {
		fields: [expenses.categoryId],
		references: [expenseCategories.id]
	}),
	vendor: one(vendors, { fields: [expenses.vendorId], references: [vendors.id] }),
	paidFromAccount: one(cashAccounts, {
		fields: [expenses.paidFromAccountId],
		references: [cashAccounts.id]
	})
}));

export const expenseCategoriesRelations = relations(expenseCategories, ({ one, many }) => ({
	hotel: one(hotels, { fields: [expenseCategories.hotelId], references: [hotels.id] }),
	expenses: many(expenses)
}));

export const vendorsRelations = relations(vendors, ({ one, many }) => ({
	hotel: one(hotels, { fields: [vendors.hotelId], references: [hotels.id] }),
	expenses: many(expenses)
}));

export const recurringExpensesRelations = relations(recurringExpenses, ({ one }) => ({
	hotel: one(hotels, { fields: [recurringExpenses.hotelId], references: [hotels.id] }),
	category: one(expenseCategories, {
		fields: [recurringExpenses.categoryId],
		references: [expenseCategories.id]
	}),
	vendor: one(vendors, { fields: [recurringExpenses.vendorId], references: [vendors.id] })
}));

export const receivablesRelations = relations(receivables, ({ one }) => ({
	hotel: one(hotels, { fields: [receivables.hotelId], references: [hotels.id] }),
	folio: one(folios, { fields: [receivables.folioId], references: [folios.id] })
}));

export const financeSettingsRelations = relations(financeSettings, ({ one }) => ({
	hotel: one(hotels, { fields: [financeSettings.hotelId], references: [hotels.id] })
}));

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type CashAccount = typeof cashAccounts.$inferSelect;
export type NewCashAccount = typeof cashAccounts.$inferInsert;
export type CashMovement = typeof cashMovements.$inferSelect;
export type NewCashMovement = typeof cashMovements.$inferInsert;
export type CashierShift = typeof cashierShifts.$inferSelect;
export type ShiftEvent = typeof shiftEvents.$inferSelect;
export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;
export type ExpenseCategory = typeof expenseCategories.$inferSelect;
export type Vendor = typeof vendors.$inferSelect;
export type RecurringExpense = typeof recurringExpenses.$inferSelect;
export type Receivable = typeof receivables.$inferSelect;
export type DayClose = typeof dayCloses.$inferSelect;
export type FinanceSettings = typeof financeSettings.$inferSelect;
