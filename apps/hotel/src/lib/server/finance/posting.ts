import { and, eq } from 'drizzle-orm';
import { cashAccounts, cashCategoryAccounts, type CashMovement } from '../db/schema/index';
import { FinanceError, type Tx } from './shared';

type CashCategory = CashMovement['category'];

/** Resolves the two legs `finance/cash.ts`'s `recordCashMovement` posts a journal
 *  entry against: the cash/bank account's own COA leaf, and the category's (or an
 *  explicit override's) home account. Both must already exist — seeded by
 *  `finance/seed-defaults.ts` for every hotel — so a miss here means the hotel's
 *  Finance setup predates the ledger feature and needs `db/migrate-backfill-coa.ts`. */
export async function resolvePostingAccounts(
	hotelId: string,
	cashAccountId: string,
	category: CashCategory,
	overrideAccountId: string | null | undefined,
	t: Tx
): Promise<{ cashLegAccountId: string; categoryLegAccountId: string }> {
	const [cashAccount] = await t
		.select({ coaAccountId: cashAccounts.coaAccountId })
		.from(cashAccounts)
		.where(eq(cashAccounts.id, cashAccountId))
		.limit(1);
	if (!cashAccount?.coaAccountId) {
		throw new FinanceError(
			'This cash account has no chart-of-accounts link yet. Run the chart-of-accounts backfill for this hotel.'
		);
	}

	if (overrideAccountId) {
		return { cashLegAccountId: cashAccount.coaAccountId, categoryLegAccountId: overrideAccountId };
	}

	const [mapping] = await t
		.select({ accountId: cashCategoryAccounts.accountId })
		.from(cashCategoryAccounts)
		.where(and(eq(cashCategoryAccounts.hotelId, hotelId), eq(cashCategoryAccounts.category, category)))
		.limit(1);
	if (!mapping) {
		throw new FinanceError(
			`No chart-of-accounts mapping for "${category}" yet. Run the chart-of-accounts backfill for this hotel.`
		);
	}

	return { cashLegAccountId: cashAccount.coaAccountId, categoryLegAccountId: mapping.accountId };
}
