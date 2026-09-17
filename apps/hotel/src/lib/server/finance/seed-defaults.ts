import { and, eq } from 'drizzle-orm';
import type { db as Db } from '../db/index';
import {
	birSettings,
	cashAccounts,
	cashCategoryAccounts,
	chartOfAccounts,
	expenseCategories,
	financeSettings,
	type CashMovement
} from '../db/schema/index';
import { mintRef } from '../ids';
import { COA_SEED, CASH_ACCOUNT_KIND_TO_COA_CODE, CASH_CATEGORY_TO_COA_CODE, EXPENSE_GROUP_TO_COA_CODE } from './coa-seed';

type DbLike = typeof Db;
type CashCategory = CashMovement['category'];

const STARTER_CATEGORIES: [string, (typeof expenseCategories.$inferInsert)['group']][] = [
	['Utilities — electricity', 'utilities'],
	['Utilities — water', 'utilities'],
	['Salaries & wages', 'payroll'],
	['Housekeeping supplies', 'supplies'],
	['Food & beverage cost', 'cogs'],
	['Repairs & maintenance', 'repairs'],
	['Marketing & OTA commissions', 'marketing'],
	['Agent commissions', 'commissions'],
	['Taxes & licenses', 'taxes_licenses'],
	['Rent', 'rent'],
	['Office & admin', 'admin'],
	['Miscellaneous', 'other']
];

/**
 * Seeds the default chart of accounts for a hotel and backfills every `coa_account_id`
 * link that lets `finance/cash.ts`'s `recordCashMovement` auto-post a mirrored journal
 * entry: each of the hotel's *existing* cash accounts (by `kind`), each of its
 * *existing* expense categories (by `group`), and one `cash_category_accounts` row
 * per `cash_movements.category` value. Reads whatever cash accounts / expense
 * categories already exist for the hotel rather than assuming it just created them,
 * so it works both as part of `seedFinanceDefaults` (called on new-hotel creation)
 * and standalone (called by `db/migrate-backfill-coa.ts` for hotels that already had
 * Finance set up before the ledger feature shipped). Idempotent per-row rather than a
 * blanket skip — inserts only whichever `chart_of_accounts` codes / `cash_category_accounts`
 * categories this hotel doesn't already have, so it also picks up new accounts/categories
 * `coa-seed.ts` grows *after* a hotel was first seeded (re-run via `migrate-backfill-coa.ts`).
 */
export async function seedChartOfAccounts(db: DbLike, hotelId: string): Promise<void> {
	const existingCoaRows = await db
		.select({ id: chartOfAccounts.id, code: chartOfAccounts.code })
		.from(chartOfAccounts)
		.where(eq(chartOfAccounts.hotelId, hotelId));
	const existingCodes = new Set(existingCoaRows.map((r) => r.code));

	const missingSeed = COA_SEED.filter((a) => !existingCodes.has(a.code));
	const insertedRows = missingSeed.length
		? await db
				.insert(chartOfAccounts)
				.values(
					missingSeed.map((a) => ({
						hotelId,
						accountRef: mintRef('account'),
						code: a.code,
						name: a.name,
						type: a.type,
						subtype: a.subtype,
						normalBalance: a.normalBalance,
						isSystem: a.isSystem ?? false
					}))
				)
				.returning({ id: chartOfAccounts.id, code: chartOfAccounts.code })
		: [];
	const allCoaRows = [...existingCoaRows, ...insertedRows];
	const byCode = (code: string): string => {
		const row = allCoaRows.find((r) => r.code === code);
		if (!row) throw new Error(`coa-seed.ts is missing account code ${code}`);
		return row.id;
	};

	const existingCashAccounts = await db
		.select({ id: cashAccounts.id, kind: cashAccounts.kind })
		.from(cashAccounts)
		.where(eq(cashAccounts.hotelId, hotelId));
	for (const a of existingCashAccounts) {
		const code = CASH_ACCOUNT_KIND_TO_COA_CODE[a.kind];
		if (code) {
			await db.update(cashAccounts).set({ coaAccountId: byCode(code) }).where(eq(cashAccounts.id, a.id));
		}
	}

	const existingCategoryMappings = await db
		.select({ category: cashCategoryAccounts.category })
		.from(cashCategoryAccounts)
		.where(eq(cashCategoryAccounts.hotelId, hotelId));
	const mappedCategories = new Set(existingCategoryMappings.map((r) => r.category));
	const missingCategoryRows = (
		Object.entries(CASH_CATEGORY_TO_COA_CODE) as [CashCategory, string][]
	)
		.filter(([category]) => !mappedCategories.has(category))
		.map(([category, code]) => ({ hotelId, category, accountId: byCode(code) }));
	if (missingCategoryRows.length) {
		await db.insert(cashCategoryAccounts).values(missingCategoryRows);
	}

	const existingExpenseCategories = await db
		.select({ id: expenseCategories.id, group: expenseCategories.group })
		.from(expenseCategories)
		.where(eq(expenseCategories.hotelId, hotelId));
	for (const c of existingExpenseCategories) {
		await db
			.update(expenseCategories)
			.set({ coaAccountId: byCode(EXPENSE_GROUP_TO_COA_CODE[c.group]) })
			.where(eq(expenseCategories.id, c.id));
	}
}

/**
 * Gives a hotel a working Finance module from day one: a front-desk drawer, a
 * petty-cash float, a bank account, an e-wallet, the system Undeposited Funds
 * holding account, a `finance_settings` row wired to them, a starter set of expense
 * categories, and the default chart of accounts with every `coa_account_id` link
 * backfilled. Idempotent — a no-op once the hotel already has cash accounts.
 */
export async function seedFinanceDefaults(db: DbLike, hotelId: string): Promise<void> {
	const existing = await db
		.select({ id: cashAccounts.id })
		.from(cashAccounts)
		.where(eq(cashAccounts.hotelId, hotelId))
		.limit(1);
	if (existing.length > 0) return;

	const accounts = await db
		.insert(cashAccounts)
		.values([
			{ hotelId, name: 'Front Desk Drawer', kind: 'cash_drawer', sortOrder: 0 },
			{ hotelId, name: 'Petty Cash', kind: 'petty_cash', sortOrder: 1 },
			{ hotelId, name: 'Bank — Main', kind: 'bank', sortOrder: 2 },
			{ hotelId, name: 'E-wallet', kind: 'e_wallet', sortOrder: 3 },
			{ hotelId, name: 'Undeposited Funds', kind: 'undeposited', isSystem: true, sortOrder: 4 }
		])
		.returning({ id: cashAccounts.id, kind: cashAccounts.kind });
	const byKind = (k: string) => accounts.find((a) => a.kind === k)?.id ?? null;

	await db
		.insert(financeSettings)
		.values({
			hotelId,
			defaultDrawerAccountId: byKind('cash_drawer'),
			defaultBankAccountId: byKind('bank'),
			undepositedAccountId: byKind('undeposited')
		})
		.onConflictDoNothing();

	// BIR accountable-forms defaults — prefixes + issuance toggles on, but no tax
	// identity or serial series yet (those are entered per hotel in Finance → BIR),
	// so documents print in disclaimer mode until then.
	await db.insert(birSettings).values({ hotelId }).onConflictDoNothing();

	const haveCategories = await db
		.select({ id: expenseCategories.id })
		.from(expenseCategories)
		.where(and(eq(expenseCategories.hotelId, hotelId)))
		.limit(1);
	if (haveCategories.length === 0) {
		await db
			.insert(expenseCategories)
			.values(
				STARTER_CATEGORIES.map(([name, group], i) => ({ hotelId, name, group, sortOrder: i }))
			);
	}

	await seedChartOfAccounts(db, hotelId);
}
