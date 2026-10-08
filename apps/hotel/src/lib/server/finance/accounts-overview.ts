import { asc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index';
import { cashCategoryAccounts, chartOfAccounts, journalLines } from '../db/schema/index';

export interface AccountOverview {
	id: string;
	code: string;
	name: string;
	type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
	subtype: string;
	normalBalance: 'debit' | 'credit';
	isPostable: boolean;
	isSystem: boolean;
	isActive: boolean;
	/** The cash-movement categories that post to this account, e.g. `dining_revenue`. */
	postsFrom: string[];
	debitCentavos: number;
	creditCentavos: number;
	/** In the account's own direction: debits less credits for a debit-normal account, the reverse otherwise. */
	balanceCentavos: number;
	/** How many journal lines have hit it (0 = nothing posted yet). */
	lines: number;
}

/**
 * Every account in a hotel's chart, with the cash categories that feed it and what has been
 * posted to it so far. Read-only. Sums are done in bigint so a busy hotel's lifetime totals
 * can't overflow.
 */
export async function listAccountsOverview(hotelId: string): Promise<AccountOverview[]> {
	const accounts = await db
		.select()
		.from(chartOfAccounts)
		.where(eq(chartOfAccounts.hotelId, hotelId))
		.orderBy(asc(chartOfAccounts.code));

	const mappings = await db
		.select({ category: cashCategoryAccounts.category, accountId: cashCategoryAccounts.accountId })
		.from(cashCategoryAccounts)
		.where(eq(cashCategoryAccounts.hotelId, hotelId));

	const sums = await db
		.select({
			accountId: journalLines.accountId,
			debit: sql<string>`coalesce(sum(${journalLines.debitCentavos}), 0)::bigint`,
			credit: sql<string>`coalesce(sum(${journalLines.creditCentavos}), 0)::bigint`,
			n: sql<number>`count(*)::int`
		})
		.from(journalLines)
		.where(eq(journalLines.hotelId, hotelId))
		.groupBy(journalLines.accountId);
	const byAccount = new Map(sums.map((s) => [s.accountId, s]));

	return accounts.map((a) => {
		const s = byAccount.get(a.id);
		const debit = Number(s?.debit ?? 0);
		const credit = Number(s?.credit ?? 0);
		return {
			id: a.id,
			code: a.code,
			name: a.name,
			type: a.type,
			subtype: a.subtype,
			normalBalance: a.normalBalance,
			isPostable: a.isPostable,
			isSystem: a.isSystem,
			isActive: a.isActive,
			postsFrom: mappings.filter((m) => m.accountId === a.id).map((m) => m.category),
			debitCentavos: debit,
			creditCentavos: credit,
			balanceCentavos: a.normalBalance === 'debit' ? debit - credit : credit - debit,
			lines: s?.n ?? 0
		};
	});
}
