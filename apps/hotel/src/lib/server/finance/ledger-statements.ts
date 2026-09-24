/**
 * Pure statement-building for the ledger reports (trial balance, income statement, balance
 * sheet) — no database, so the sign rules that make a statement right are unit-tested.
 *
 * THE sign rule: an amount is signed by the account's **type**, never its `normalBalance`.
 *   income  = credit − debit      expense = debit − credit
 *   asset   = debit − credit      liability / equity = credit − debit
 * That makes a contra account come out negative inside its own section without any special case:
 * "Refunds & Allowances" (income, debit-normal) reduces revenue; "Owner's Draw" (equity,
 * debit-normal) reduces equity. Signing by normal balance instead would ADD a refund to revenue.
 */

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export interface AccountSums {
	accountId: string;
	code: string;
	name: string;
	type: AccountType;
	debit: number;
	credit: number;
}

export interface StatementLine {
	accountId: string;
	code: string;
	name: string;
	amountCentavos: number;
}

/** What the account contributes to its own section, in centavos (see the sign rule above). */
export function naturalAmount(a: Pick<AccountSums, 'type' | 'debit' | 'credit'>): number {
	return a.type === 'asset' || a.type === 'expense' ? a.debit - a.credit : a.credit - a.debit;
}

const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code, 'en', { numeric: true });

const toLines = (accts: AccountSums[], keep: (a: AccountSums) => boolean): StatementLine[] =>
	accts
		.filter(keep)
		.map((a) => ({ accountId: a.accountId, code: a.code, name: a.name, amountCentavos: naturalAmount(a) }))
		.filter((l) => l.amountCentavos !== 0)
		.sort(byCode);

const sum = (lines: StatementLine[]) => lines.reduce((s, l) => s + l.amountCentavos, 0);

// --- Trial balance ---------------------------------------------------------

export interface TrialBalance {
	lines: { accountId: string; code: string; name: string; type: AccountType; debit: number; credit: number }[];
	totalDebit: number;
	totalCredit: number;
	/** Debits equal credits. Always true for a ledger built only through `postJournalEntry` — a
	 *  false here means an entry was written around the choke point. */
	balanced: boolean;
	difference: number;
}

/** Period debits and credits per account. Accounts with no activity are dropped unless `showAll`. */
export function buildTrialBalance(accts: AccountSums[], opts: { showAll?: boolean } = {}): TrialBalance {
	const lines = accts
		.filter((a) => opts.showAll || a.debit !== 0 || a.credit !== 0)
		.map(({ accountId, code, name, type, debit, credit }) => ({ accountId, code, name, type, debit, credit }))
		.sort(byCode);
	// Totals over EVERY account, not just the visible lines — hiding a zero row can't hide an imbalance.
	const totalDebit = accts.reduce((s, a) => s + a.debit, 0);
	const totalCredit = accts.reduce((s, a) => s + a.credit, 0);
	return { lines, totalDebit, totalCredit, balanced: totalDebit === totalCredit, difference: totalDebit - totalCredit };
}

// --- Income statement ------------------------------------------------------

export interface IncomeStatement {
	income: StatementLine[];
	expenses: StatementLine[];
	totalIncome: number;
	totalExpenses: number;
	netIncome: number;
}

export function buildIncomeStatement(accts: AccountSums[]): IncomeStatement {
	const income = toLines(accts, (a) => a.type === 'income');
	const expenses = toLines(accts, (a) => a.type === 'expense');
	const totalIncome = sum(income);
	const totalExpenses = sum(expenses);
	return { income, expenses, totalIncome, totalExpenses, netIncome: totalIncome - totalExpenses };
}

// --- Balance sheet ---------------------------------------------------------

export interface BalanceSheet {
	assets: StatementLine[];
	liabilities: StatementLine[];
	/** Equity accounts only; `earningsToDate` is separate and included in `totalEquity`. */
	equity: StatementLine[];
	/** Cumulative income − expense. Nothing closes income into retained earnings yet, so without
	 *  this line the sheet is out by exactly the profit to date. */
	earningsToDate: number;
	totalAssets: number;
	totalLiabilities: number;
	totalEquity: number;
	balanced: boolean;
	/** Assets − (liabilities + equity). Zero when the books are sound. */
	difference: number;
}

/** `accts` must be CUMULATIVE sums through the as-of date and include income/expense accounts. */
export function buildBalanceSheet(accts: AccountSums[]): BalanceSheet {
	const assets = toLines(accts, (a) => a.type === 'asset');
	const liabilities = toLines(accts, (a) => a.type === 'liability');
	const equity = toLines(accts, (a) => a.type === 'equity');
	const { netIncome: earningsToDate } = buildIncomeStatement(accts);
	const totalAssets = sum(assets);
	const totalLiabilities = sum(liabilities);
	const totalEquity = sum(equity) + earningsToDate;
	const difference = totalAssets - (totalLiabilities + totalEquity);
	return { assets, liabilities, equity, earningsToDate, totalAssets, totalLiabilities, totalEquity, balanced: difference === 0, difference };
}
