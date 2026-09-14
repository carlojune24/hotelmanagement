import { relations } from 'drizzle-orm';
import { bigint, boolean, date, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, updatedAt } from './_shared';
import { hotels } from './hotels';
import { users } from './auth';
import { cashCategory } from './finance';

/**
 * Double-entry ledger — additive alongside the cash-basis `finance.ts` tables, not
 * a replacement. Every cash movement auto-posts a mirrored journal entry (see
 * `lib/server/finance/cash.ts`'s `recordCashMovement`); front-desk/finance staff
 * keep using the cash-basis screens exactly as before. Per-hotel, like every other
 * tenant table — see `docs/standards/finance.md`.
 */

// ---------------------------------------------------------------------------
// Chart of accounts
// ---------------------------------------------------------------------------

export const accountType = pgEnum('ledger_account_type', [
	'asset',
	'liability',
	'equity',
	'income',
	'expense'
]);

export const normalBalance = pgEnum('ledger_normal_balance', ['debit', 'credit']);

/**
 * Per-hotel chart of accounts. `subtype` is plain `text`, validated against
 * `@mm/finance-core`'s `accountSubtype` Zod enum at the app layer — not a
 * `pgEnum`, because the taxonomy will keep growing as other MM apps add subtypes,
 * and a `pgEnum` would force a migration per addition.
 */
export const chartOfAccounts = pgTable(
	'chart_of_accounts',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		/** `acct_<ULID>` — cross-app identity, minted via `mintRef('account')`. */
		accountRef: text('account_ref').notNull().unique(),
		code: text('code').notNull(),
		name: text('name').notNull(),
		type: accountType('type').notNull(),
		subtype: text('subtype').notNull(),
		normalBalance: normalBalance('normal_balance').notNull(),
		parentId: uuid('parent_id'),
		isPostable: boolean('is_postable').notNull().default(true),
		/** Seeded accounts — protected from delete/rename, mirrors `cash_accounts.isSystem`. */
		isSystem: boolean('is_system').notNull().default(false),
		isActive: boolean('is_active').notNull().default(true),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('chart_of_accounts_hotel_idx').on(t.hotelId),
		uniqueIndex('chart_of_accounts_hotel_code_idx').on(t.hotelId, t.code)
	]
);

/** Which COA leaf a given `cash_movements.category` posts to for a hotel — one row
 *  per hotel per `cashCategory` value. `transfer_in`/`transfer_out`/`bank_deposit`
 *  all map to the same clearing account so each `recordCashMovement` call (which
 *  never sees its paired leg) still balances on its own. */
export const cashCategoryAccounts = pgTable(
	'cash_category_accounts',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		category: cashCategory('category').notNull(),
		accountId: uuid('account_id')
			.notNull()
			.references(() => chartOfAccounts.id, { onDelete: 'restrict' })
	},
	(t) => [uniqueIndex('cash_category_accounts_hotel_category_idx').on(t.hotelId, t.category)]
);

// ---------------------------------------------------------------------------
// Journal entries — immutable double-entry ledger
// ---------------------------------------------------------------------------

export const journalSourceType = pgEnum('journal_source_type', ['cash_movement', 'manual']);

/** Immutable header. Corrections are made only by posting a reversing entry
 *  (`reversalOfEntryId` set, every line's debit/credit swapped) — never by editing
 *  or deleting a posted entry. */
export const journalEntries = pgTable(
	'journal_entries',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		/** `JE-000123`, gapless per-hotel sequence — see `finance_settings.nextJournalEntryNo`. */
		entryNo: text('entry_no').notNull(),
		/** Business date, ties to `assertBusinessDateOpen` like every other dated Finance write. */
		entryDate: date('entry_date', { mode: 'string' }).notNull(),
		memo: text('memo'),
		sourceType: journalSourceType('source_type').notNull(),
		/** The triggering row's id — in practice a `cash_movements.id`. No FK: a
		 *  generic link, same convention as `cash_movements.sourceId`. */
		sourceId: uuid('source_id'),
		reversalOfEntryId: uuid('reversal_of_entry_id'),
		postedAt: timestamp('posted_at', { withTimezone: true }).notNull().defaultNow(),
		postedByUserId: uuid('posted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(t) => [
		index('journal_entries_hotel_date_idx').on(t.hotelId, t.entryDate),
		index('journal_entries_hotel_source_idx').on(t.hotelId, t.sourceType, t.sourceId),
		uniqueIndex('journal_entries_hotel_entry_no_idx').on(t.hotelId, t.entryNo)
	]
);

export const journalLines = pgTable(
	'journal_lines',
	{
		id: pk(),
		journalEntryId: uuid('journal_entry_id')
			.notNull()
			.references(() => journalEntries.id, { onDelete: 'cascade' }),
		accountId: uuid('account_id')
			.notNull()
			.references(() => chartOfAccounts.id, { onDelete: 'restrict' }),
		debitCentavos: bigint('debit_centavos', { mode: 'number' }).notNull().default(0),
		creditCentavos: bigint('credit_centavos', { mode: 'number' }).notNull().default(0),
		/** Denormalized copy of the header's `hotelId`, so a line carries its own
		 *  dimensions without a join — this is what makes ledger/trial-balance fast. */
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		department: text('department'),
		costCenter: text('cost_center'),
		project: text('project'),
		/** No FK — generic link, same convention as `cash_movements.counterpartyId`. */
		counterpartyId: uuid('counterparty_id')
	},
	(t) => [
		index('journal_lines_entry_idx').on(t.journalEntryId),
		index('journal_lines_hotel_account_idx').on(t.hotelId, t.accountId)
	]
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const chartOfAccountsRelations = relations(chartOfAccounts, ({ one, many }) => ({
	hotel: one(hotels, { fields: [chartOfAccounts.hotelId], references: [hotels.id] }),
	parent: one(chartOfAccounts, {
		fields: [chartOfAccounts.parentId],
		references: [chartOfAccounts.id]
	}),
	journalLines: many(journalLines)
}));

export const cashCategoryAccountsRelations = relations(cashCategoryAccounts, ({ one }) => ({
	hotel: one(hotels, { fields: [cashCategoryAccounts.hotelId], references: [hotels.id] }),
	account: one(chartOfAccounts, {
		fields: [cashCategoryAccounts.accountId],
		references: [chartOfAccounts.id]
	})
}));

export const journalEntriesRelations = relations(journalEntries, ({ one, many }) => ({
	hotel: one(hotels, { fields: [journalEntries.hotelId], references: [hotels.id] }),
	lines: many(journalLines)
}));

export const journalLinesRelations = relations(journalLines, ({ one }) => ({
	entry: one(journalEntries, { fields: [journalLines.journalEntryId], references: [journalEntries.id] }),
	account: one(chartOfAccounts, { fields: [journalLines.accountId], references: [chartOfAccounts.id] })
}));

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type ChartOfAccount = typeof chartOfAccounts.$inferSelect;
export type NewChartOfAccount = typeof chartOfAccounts.$inferInsert;
export type CashCategoryAccount = typeof cashCategoryAccounts.$inferSelect;
export type JournalEntry = typeof journalEntries.$inferSelect;
export type NewJournalEntry = typeof journalEntries.$inferInsert;
export type JournalLine = typeof journalLines.$inferSelect;
export type NewJournalLine = typeof journalLines.$inferInsert;
