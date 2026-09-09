import { and, eq } from 'drizzle-orm';
import type { db as Db } from '../db/index';
import { birSettings, cashAccounts, expenseCategories, financeSettings } from '../db/schema/index';

type DbLike = typeof Db;

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
 * Gives a hotel a working Finance module from day one: a front-desk drawer, a
 * petty-cash float, a bank account, an e-wallet, the system Undeposited Funds
 * holding account, a `finance_settings` row wired to them, and a starter set of
 * expense categories. Idempotent — a no-op once the hotel already has cash accounts.
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
}
