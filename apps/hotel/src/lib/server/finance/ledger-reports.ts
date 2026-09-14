import { and, asc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { db } from '../db/index';
import { chartOfAccounts, journalEntries, journalLines } from '../db/schema/index';
import { FinanceError } from './shared';
import type {
	AccountSubtype,
	BalanceSheetRow,
	IncomeStatementRow,
	LedgerRow,
	ReportParams,
	TrialBalanceRow
} from '@mm/finance-core';

/**
 * Report builders for the double-entry ledger — implements `@mm/finance-core`'s
 * `reports.ts` contracts against this app's schema. Every function takes
 * `hotelIds: string[]`, so the same code serves one hotel, a hotel group, or (via
 * `/api/v1/finance/reports/*`) a future cross-app consolidator.
 */

function humanizeSubtype(subtype: string): string {
	return subtype.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

async function sumsByAccount(hotelIds: string[], dateFrom: string, dateTo: string) {
	return db
		.select({
			accountId: journalLines.accountId,
			debitMinor: sql<number>`coalesce(sum(${journalLines.debitCentavos}), 0)::int`,
			creditMinor: sql<number>`coalesce(sum(${journalLines.creditCentavos}), 0)::int`
		})
		.from(journalLines)
		.innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
		.where(
			and(
				inArray(journalLines.hotelId, hotelIds),
				gte(journalEntries.entryDate, dateFrom),
				lte(journalEntries.entryDate, dateTo)
			)
		)
		.groupBy(journalLines.accountId);
}

/** Debits/credits per account for the range. The grand total across every returned
 *  row must balance — each posted entry is individually balanced, so the sum is too. */
export async function trialBalance(params: ReportParams): Promise<TrialBalanceRow[]> {
	const accounts = await db
		.select()
		.from(chartOfAccounts)
		.where(inArray(chartOfAccounts.hotelId, params.hotelIds))
		.orderBy(asc(chartOfAccounts.code));
	const sums = await sumsByAccount(params.hotelIds, params.dateFrom, params.dateTo);
	const byAccount = new Map(sums.map((s) => [s.accountId, s]));

	return accounts.map((a) => {
		const s = byAccount.get(a.id);
		return {
			accountId: a.id,
			code: a.code,
			name: a.name,
			type: a.type,
			debitMinor: s?.debitMinor ?? 0,
			creditMinor: s?.creditMinor ?? 0
		};
	});
}

/** Revenue less expense, grouped by subtype, with one column per requested
 *  `hotelId` plus a total — the shape a group or an external consolidator sums. */
export async function incomeStatement(params: ReportParams): Promise<IncomeStatementRow[]> {
	const accounts = await db
		.select({
			id: chartOfAccounts.id,
			hotelId: chartOfAccounts.hotelId,
			subtype: chartOfAccounts.subtype,
			normalBalance: chartOfAccounts.normalBalance
		})
		.from(chartOfAccounts)
		.where(and(inArray(chartOfAccounts.hotelId, params.hotelIds), inArray(chartOfAccounts.type, ['income', 'expense'])));
	const sums = await sumsByAccount(params.hotelIds, params.dateFrom, params.dateTo);
	const byAccount = new Map(sums.map((s) => [s.accountId, s]));

	const bySubtype = new Map<string, IncomeStatementRow>();
	for (const a of accounts) {
		const s = byAccount.get(a.id);
		if (!s) continue;
		const net = a.normalBalance === 'credit' ? s.creditMinor - s.debitMinor : s.debitMinor - s.creditMinor;
		if (net === 0) continue;

		let row = bySubtype.get(a.subtype);
		if (!row) {
			row = { subtype: a.subtype as AccountSubtype, label: humanizeSubtype(a.subtype), byHotel: {}, total: 0 };
			bySubtype.set(a.subtype, row);
		}
		row.byHotel[a.hotelId] = (row.byHotel[a.hotelId] ?? 0) + net;
		row.total += net;
	}
	return [...bySubtype.values()];
}

/** Asset/liability/equity balances as of `dateTo`, running from account inception
 *  (no lower date bound — a balance sheet is a point-in-time snapshot). */
export async function balanceSheet(params: ReportParams): Promise<BalanceSheetRow[]> {
	const accounts = await db
		.select()
		.from(chartOfAccounts)
		.where(
			and(inArray(chartOfAccounts.hotelId, params.hotelIds), inArray(chartOfAccounts.type, ['asset', 'liability', 'equity']))
		)
		.orderBy(asc(chartOfAccounts.code));

	const sums = await db
		.select({
			accountId: journalLines.accountId,
			debitMinor: sql<number>`coalesce(sum(${journalLines.debitCentavos}), 0)::int`,
			creditMinor: sql<number>`coalesce(sum(${journalLines.creditCentavos}), 0)::int`
		})
		.from(journalLines)
		.innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
		.where(and(inArray(journalLines.hotelId, params.hotelIds), lte(journalEntries.entryDate, params.dateTo)))
		.groupBy(journalLines.accountId);
	const byAccount = new Map(sums.map((s) => [s.accountId, s]));

	return accounts.map((a) => {
		const s = byAccount.get(a.id);
		const balanceMinor =
			a.normalBalance === 'debit' ? (s?.debitMinor ?? 0) - (s?.creditMinor ?? 0) : (s?.creditMinor ?? 0) - (s?.debitMinor ?? 0);
		return {
			accountId: a.id,
			code: a.code,
			name: a.name,
			type: a.type,
			subtype: a.subtype as AccountSubtype,
			balanceMinor
		};
	});
}

/** Opening balance + chronological movements + running balance for one account,
 *  drillable via `sourceType`/`sourceId` — mirrors `finance/cash.ts`'s
 *  `getCashPosition` shape. */
export async function generalLedger(params: ReportParams & { accountId: string }): Promise<LedgerRow[]> {
	const [account] = await db
		.select({ normalBalance: chartOfAccounts.normalBalance })
		.from(chartOfAccounts)
		.where(and(eq(chartOfAccounts.id, params.accountId), inArray(chartOfAccounts.hotelId, params.hotelIds)))
		.limit(1);
	if (!account) throw new FinanceError('Account not found.');
	const sign = (debit: number, credit: number) =>
		account.normalBalance === 'debit' ? debit - credit : credit - debit;

	const [opening] = await db
		.select({
			debitMinor: sql<number>`coalesce(sum(${journalLines.debitCentavos}), 0)::int`,
			creditMinor: sql<number>`coalesce(sum(${journalLines.creditCentavos}), 0)::int`
		})
		.from(journalLines)
		.innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
		.where(
			and(
				eq(journalLines.accountId, params.accountId),
				inArray(journalLines.hotelId, params.hotelIds),
				lt(journalEntries.entryDate, params.dateFrom)
			)
		);
	let running = sign(opening?.debitMinor ?? 0, opening?.creditMinor ?? 0);

	const movements = await db
		.select({
			journalEntryId: journalEntries.id,
			entryNo: journalEntries.entryNo,
			date: journalEntries.entryDate,
			memo: journalEntries.memo,
			sourceType: journalEntries.sourceType,
			sourceId: journalEntries.sourceId,
			debitMinor: journalLines.debitCentavos,
			creditMinor: journalLines.creditCentavos
		})
		.from(journalLines)
		.innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
		.where(
			and(
				eq(journalLines.accountId, params.accountId),
				inArray(journalLines.hotelId, params.hotelIds),
				gte(journalEntries.entryDate, params.dateFrom),
				lte(journalEntries.entryDate, params.dateTo)
			)
		)
		.orderBy(asc(journalEntries.entryDate), asc(journalEntries.postedAt));

	const rows: LedgerRow[] = [];
	for (const m of movements) {
		running += sign(m.debitMinor, m.creditMinor);
		rows.push({
			journalEntryId: m.journalEntryId,
			entryNo: m.entryNo,
			date: m.date,
			memo: m.memo,
			sourceType: m.sourceType,
			sourceId: m.sourceId,
			debitMinor: m.debitMinor,
			creditMinor: m.creditMinor,
			runningBalanceMinor: running
		});
	}
	return rows;
}
