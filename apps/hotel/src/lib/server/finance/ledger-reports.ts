import { and, asc, eq, gte, inArray, lt, lte, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index';
import { cashMovements, chartOfAccounts, journalEntries, journalLines, payments } from '../db/schema/index';
import { FinanceError } from './shared';
import { sumCentavos } from './sql';
import { naturalAmount, type AccountSums } from './ledger-statements';
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
			debitMinor: sumCentavos(journalLines.debitCentavos),
			creditMinor: sumCentavos(journalLines.creditCentavos)
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
			type: chartOfAccounts.type
		})
		.from(chartOfAccounts)
		.where(and(inArray(chartOfAccounts.hotelId, params.hotelIds), inArray(chartOfAccounts.type, ['income', 'expense'])));
	const sums = await sumsByAccount(params.hotelIds, params.dateFrom, params.dateTo);
	const byAccount = new Map(sums.map((s) => [s.accountId, s]));

	const bySubtype = new Map<string, IncomeStatementRow>();
	for (const a of accounts) {
		const s = byAccount.get(a.id);
		if (!s) continue;
		// Signed by TYPE (see `ledger-statements.ts`), not normal balance: a contra-revenue account
		// like 4090 Refunds & Allowances is income-type but debit-normal, and signing it by normal
		// balance would ADD refunds to revenue.
		const net = naturalAmount({ type: a.type, debit: s.debitMinor, credit: s.creditMinor });
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
			debitMinor: sumCentavos(journalLines.debitCentavos),
			creditMinor: sumCentavos(journalLines.creditCentavos)
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
			debitMinor: sumCentavos(journalLines.debitCentavos),
			creditMinor: sumCentavos(journalLines.creditCentavos)
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

// ---------------------------------------------------------------------------
// Staff-facing statements — sums per account, and the general ledger with drill-down.
// (The functions above are the published `@mm/finance-core` contracts and stay as they are.)
// ---------------------------------------------------------------------------

/** Debits and credits per account (every account, zero or not) for `dateFrom..dateTo`, or
 *  cumulative through `dateTo` when `dateFrom` is null — feeds `ledger-statements.ts`. */
export async function accountSums(hotelId: string, dateFrom: string | null, dateTo: string): Promise<AccountSums[]> {
	const [accounts, sums] = await Promise.all([
		db
			.select({ id: chartOfAccounts.id, code: chartOfAccounts.code, name: chartOfAccounts.name, type: chartOfAccounts.type })
			.from(chartOfAccounts)
			.where(eq(chartOfAccounts.hotelId, hotelId)),
		db
			.select({
				accountId: journalLines.accountId,
				debit: sumCentavos(journalLines.debitCentavos),
				credit: sumCentavos(journalLines.creditCentavos)
			})
			.from(journalLines)
			.innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
			.where(
				and(
					eq(journalLines.hotelId, hotelId),
					lte(journalEntries.entryDate, dateTo),
					dateFrom ? gte(journalEntries.entryDate, dateFrom) : undefined
				)
			)
			.groupBy(journalLines.accountId)
	]);
	const byAccount = new Map(sums.map((s) => [s.accountId, s]));
	return accounts.map((a) => ({
		accountId: a.id,
		code: a.code,
		name: a.name,
		type: a.type,
		debit: byAccount.get(a.id)?.debit ?? 0,
		credit: byAccount.get(a.id)?.credit ?? 0
	}));
}

/** The hotel's chart of accounts, by code — for the general ledger's account picker. */
export async function listLedgerAccounts(hotelId: string) {
	const rows = await db
		.select({ id: chartOfAccounts.id, code: chartOfAccounts.code, name: chartOfAccounts.name, type: chartOfAccounts.type })
		.from(chartOfAccounts)
		.where(eq(chartOfAccounts.hotelId, hotelId));
	return rows.sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
}

/** Where a ledger entry came from, as an intent the page turns into a URL (it knows the base path). */
export type SourceLink = { kind: 'order'; id: string } | { kind: 'expenses' } | { kind: 'shift'; id: string };

export interface GeneralLedgerEntryLine {
	code: string;
	name: string;
	debitCentavos: number;
	creditCentavos: number;
}

export interface GeneralLedgerPage {
	account: { id: string; code: string; name: string; type: AccountSums['type']; normalBalance: 'debit' | 'credit' };
	openingCentavos: number;
	totalDebitCentavos: number;
	totalCreditCentavos: number;
	/** Opening ± the whole period — correct even when `rows` is truncated. */
	closingCentavos: number;
	rows: {
		journalEntryId: string;
		entryNo: string;
		date: string;
		memo: string | null;
		sourceType: string;
		debitCentavos: number;
		creditCentavos: number;
		runningBalanceCentavos: number;
		/** Every line of the entry — the other side of the transaction, for the drill-down. */
		lines: GeneralLedgerEntryLine[];
		link: SourceLink | null;
	}[];
	/** More entries exist in the period than `limit`. */
	truncated: boolean;
}

/**
 * One account's activity for `from..to`: opening balance, entries with a running balance, and
 * each entry's full set of lines plus a link back to its source. The balance is signed in the
 * account's own normal direction (a liability's balance is credits − debits), like the published
 * `generalLedger`. `limit` caps the rows returned, never the totals.
 */
export async function generalLedgerPage(
	hotelId: string,
	accountId: string,
	from: string,
	to: string,
	limit = 500
): Promise<GeneralLedgerPage> {
	const [account] = await db
		.select({
			id: chartOfAccounts.id,
			code: chartOfAccounts.code,
			name: chartOfAccounts.name,
			type: chartOfAccounts.type,
			normalBalance: chartOfAccounts.normalBalance
		})
		.from(chartOfAccounts)
		.where(and(eq(chartOfAccounts.id, accountId), eq(chartOfAccounts.hotelId, hotelId)))
		.limit(1);
	if (!account) throw new FinanceError('Account not found.');
	const sign = (d: number, c: number) => (account.normalBalance === 'debit' ? d - c : c - d);

	const sumWhere = (dateCond: SQL | undefined) =>
		db
			.select({ debit: sumCentavos(journalLines.debitCentavos), credit: sumCentavos(journalLines.creditCentavos) })
			.from(journalLines)
			.innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
			.where(and(eq(journalLines.accountId, accountId), eq(journalLines.hotelId, hotelId), dateCond));

	const [[before], [period], movements] = await Promise.all([
		sumWhere(lt(journalEntries.entryDate, from)),
		sumWhere(and(gte(journalEntries.entryDate, from), lte(journalEntries.entryDate, to))),
		db
			.select({
				journalEntryId: journalEntries.id,
				entryNo: journalEntries.entryNo,
				date: journalEntries.entryDate,
				memo: journalEntries.memo,
				sourceType: journalEntries.sourceType,
				sourceId: journalEntries.sourceId,
				debit: journalLines.debitCentavos,
				credit: journalLines.creditCentavos
			})
			.from(journalLines)
			.innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
			.where(
				and(
					eq(journalLines.accountId, accountId),
					eq(journalLines.hotelId, hotelId),
					gte(journalEntries.entryDate, from),
					lte(journalEntries.entryDate, to)
				)
			)
			.orderBy(asc(journalEntries.entryDate), asc(journalEntries.postedAt), asc(journalEntries.entryNo))
			.limit(limit + 1)
	]);

	const opening = sign(before?.debit ?? 0, before?.credit ?? 0);
	const totalDebit = period?.debit ?? 0;
	const totalCredit = period?.credit ?? 0;
	const truncated = movements.length > limit;
	const shown = movements.slice(0, limit);

	// Every line of each shown entry (the other side of the transaction).
	const entryIds = [...new Set(shown.map((m) => m.journalEntryId))];
	const lineRows = entryIds.length
		? await db
				.select({
					journalEntryId: journalLines.journalEntryId,
					code: chartOfAccounts.code,
					name: chartOfAccounts.name,
					debit: journalLines.debitCentavos,
					credit: journalLines.creditCentavos
				})
				.from(journalLines)
				.innerJoin(chartOfAccounts, eq(chartOfAccounts.id, journalLines.accountId))
				.where(inArray(journalLines.journalEntryId, entryIds))
				.orderBy(asc(chartOfAccounts.code))
		: [];
	const linesByEntry = new Map<string, GeneralLedgerEntryLine[]>();
	for (const l of lineRows) {
		const arr = linesByEntry.get(l.journalEntryId) ?? [];
		arr.push({ code: l.code, name: l.name, debitCentavos: l.debit, creditCentavos: l.credit });
		linesByEntry.set(l.journalEntryId, arr);
	}

	// Source links: a cash-movement entry → its payment's booking, its expense, or its shift.
	const movementIds = [...new Set(shown.filter((m) => m.sourceType === 'cash_movement' && m.sourceId).map((m) => m.sourceId!))];
	const movementRows = movementIds.length
		? await db
				.select({ id: cashMovements.id, sourceType: cashMovements.sourceType, sourceId: cashMovements.sourceId, paymentId: cashMovements.paymentId })
				.from(cashMovements)
				.where(and(inArray(cashMovements.id, movementIds), eq(cashMovements.hotelId, hotelId)))
		: [];
	const paymentIds = [...new Set(movementRows.map((m) => m.paymentId).filter((p): p is string => !!p))];
	const paymentRows = paymentIds.length
		? await db.select({ id: payments.id, orderId: payments.orderId }).from(payments).where(inArray(payments.id, paymentIds))
		: [];
	const orderByPayment = new Map(paymentRows.map((p) => [p.id, p.orderId]));
	const linkByMovement = new Map<string, SourceLink | null>();
	for (const m of movementRows) {
		const orderId = m.paymentId ? orderByPayment.get(m.paymentId) : null;
		linkByMovement.set(
			m.id,
			orderId
				? { kind: 'order', id: orderId }
				: m.sourceType === 'expense'
					? { kind: 'expenses' }
					: m.sourceType === 'shift_event' && m.sourceId
						? { kind: 'shift', id: m.sourceId }
						: null
		);
	}

	let running = opening;
	return {
		account,
		openingCentavos: opening,
		totalDebitCentavos: totalDebit,
		totalCreditCentavos: totalCredit,
		closingCentavos: opening + sign(totalDebit, totalCredit),
		truncated,
		rows: shown.map((m) => {
			running += sign(m.debit, m.credit);
			return {
				journalEntryId: m.journalEntryId,
				entryNo: m.entryNo,
				date: m.date,
				memo: m.memo,
				sourceType: m.sourceType,
				debitCentavos: m.debit,
				creditCentavos: m.credit,
				runningBalanceCentavos: running,
				lines: linesByEntry.get(m.journalEntryId) ?? [],
				link: m.sourceType === 'cash_movement' && m.sourceId ? (linkByMovement.get(m.sourceId) ?? null) : null
			};
		})
	};
}
