import { and, asc, eq } from 'drizzle-orm';
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
import {
	COA_SEED,
	CASH_ACCOUNT_KIND_TO_COA_CODE,
	CASH_CATEGORY_TO_COA_CODE,
	EXPENSE_GROUP_TO_COA_CODE,
	coaTemplateForKind,
	nextCoaCodeInDecade
} from './coa-seed';

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
		.select({ id: cashAccounts.id, name: cashAccounts.name, kind: cashAccounts.kind, sortOrder: cashAccounts.sortOrder })
		.from(cashAccounts)
		.where(eq(cashAccounts.hotelId, hotelId))
		.orderBy(asc(cashAccounts.sortOrder), asc(cashAccounts.name));
	// The first account of a kind takes that kind's seeded line (a drawer → 1010). A second one
	// — dining's till, a bar's — gets a line of its own in the same decade, named after it, the
	// way `createCashAccount` mints one: sharing 1010 would merge two tills on the balance sheet.
	const takenCodes = new Set(allCoaRows.map((r) => r.code));
	const claimedKinds = new Set<string>();
	for (const a of existingCashAccounts) {
		const seeded = CASH_ACCOUNT_KIND_TO_COA_CODE[a.kind];
		if (!seeded) continue;
		let coaAccountId: string | null = null;
		if (!claimedKinds.has(a.kind)) {
			claimedKinds.add(a.kind);
			coaAccountId = byCode(seeded);
		} else {
			const template = coaTemplateForKind(a.kind);
			const code = nextCoaCodeInDecade(a.kind, takenCodes);
			if (template && code) {
				const [leaf] = await db
					.insert(chartOfAccounts)
					.values({
						hotelId,
						accountRef: mintRef('account'),
						code,
						name: a.name,
						type: template.type,
						subtype: template.subtype,
						normalBalance: template.normalBalance
					})
					.returning({ id: chartOfAccounts.id });
				takenCodes.add(code);
				coaAccountId = leaf!.id;
			}
		}
		if (coaAccountId) {
			await db.update(cashAccounts).set({ coaAccountId }).where(eq(cashAccounts.id, a.id));
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

	// Two tills from the start: the counter's and the restaurant's. Dining rings into its own,
	// counts its own shift and carries its own line on the balance sheet — see
	// docs/dining-cash-drawer.md. A hotel with no restaurant simply never opens the second one.
	const accounts = await db
		.insert(cashAccounts)
		.values([
			{ hotelId, name: 'Front Desk Drawer', kind: 'cash_drawer', sortOrder: 0 },
			{ hotelId, name: 'Dining Desk Drawer', kind: 'cash_drawer', sortOrder: 1 },
			{ hotelId, name: 'Petty Cash', kind: 'petty_cash', sortOrder: 2 },
			{ hotelId, name: 'Bank — Main', kind: 'bank', sortOrder: 3 },
			{ hotelId, name: 'E-wallet', kind: 'e_wallet', sortOrder: 4 },
			{ hotelId, name: 'Undeposited Funds', kind: 'undeposited', isSystem: true, sortOrder: 5 }
		])
		.returning({ id: cashAccounts.id, name: cashAccounts.name, kind: cashAccounts.kind });
	const byKind = (k: string) => accounts.find((a) => a.kind === k)?.id ?? null;
	const byName = (n: string) => accounts.find((a) => a.name === n)?.id ?? null;

	await db
		.insert(financeSettings)
		.values({
			hotelId,
			defaultDrawerAccountId: byName('Front Desk Drawer'),
			diningDrawerAccountId: byName('Dining Desk Drawer'),
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
