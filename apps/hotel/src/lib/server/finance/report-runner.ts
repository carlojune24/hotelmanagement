import { db } from '../db/index';
import { businessDateFor } from './shared';
import { accountSums, generalLedgerPage, listLedgerAccounts, type SourceLink } from './ledger-reports';
import { buildBalanceSheet, buildIncomeStatement, buildTrialBalance, type StatementLine } from './ledger-statements';
import { cashLedgerTieOut } from './tieout';
import {
	arAgingReport,
	cashPositionReport,
	cashflowReport,
	dailySalesReport,
	expenseReport,
	paymentMethodBreakdown,
	revenueBySourceReport,
	toCsv
} from './reports';
import { quickSalesReport } from './standalone-sales';

/** `group` only decides which heading the index files a report under. */
export const REPORTS = [
	{ slug: 'trial-balance', name: 'Trial balance', kind: 'range', group: 'ledger' },
	{ slug: 'general-ledger', name: 'General ledger', kind: 'range', group: 'ledger' },
	{ slug: 'income-statement', name: 'Income statement', kind: 'range', group: 'ledger' },
	{ slug: 'balance-sheet', name: 'Balance sheet', kind: 'asOf', group: 'ledger' },
	{ slug: 'daily-sales', name: 'Daily sales', kind: 'day', group: 'cash' },
	{ slug: 'quick-sales', name: 'Quick sales', kind: 'range', group: 'cash' },
	{ slug: 'cash-position', name: 'Cash position', kind: 'range', group: 'cash' },
	{ slug: 'cashflow', name: 'Cashflow', kind: 'range', group: 'cash' },
	{ slug: 'revenue-by-source', name: 'Revenue by source', kind: 'range', group: 'cash' },
	{ slug: 'expenses', name: 'Expenses', kind: 'range', group: 'cash' },
	{ slug: 'payment-methods', name: 'Payment methods', kind: 'range', group: 'cash' },
	{ slug: 'ar-aging', name: 'City-ledger aging', kind: 'asOf', group: 'cash' }
] as const;

export type ReportSlug = (typeof REPORTS)[number]['slug'];

const peso = (c: number) => (c / 100).toFixed(2);

/** Most entries the general ledger renders at once; the totals always cover the whole period. */
const GENERAL_LEDGER_ROW_LIMIT = 500;

/** Optional per-row presentation. Rows stay plain `(string | number)[]` so CSV export and every
 *  older report are untouched; the page reads this alongside them, by index. */
export interface RowMeta {
	/** `section` = a heading spanning the row; `subtotal` / `total` = ruled totals; `opening` = the
	 *  general ledger's carried-forward balance. Omitted for an ordinary row. */
	kind?: 'section' | 'subtotal' | 'total' | 'opening';
	/** Where the row's entry came from — the page turns this into a URL. */
	link?: SourceLink;
	/** Every line of the journal entry, shown when the row is expanded. */
	detail?: { code: string; name: string; debit: string; credit: string }[];
}

export interface TieOutView {
	ok: boolean;
	/** Ledger accounts compared. */
	checked: number;
	/** Only the ones that disagree. */
	failing: { name: string; stored: string; ledger: string; reasons: string[] }[];
}

export interface RunReportResult {
	name: string;
	kind: 'day' | 'range' | 'asOf';
	columns: string[];
	rows: (string | number)[][];
	/** Summary key/value pairs rendered above the table. */
	summary: [string, string][];
	/** Zero-based indexes of columns holding centavo amounts as `1234.50` strings. The page formats
	 *  those for reading; the CSV keeps them raw. */
	moneyColumns?: number[];
	/** Labels of `summary` entries whose value is a centavo amount (`1234.50`), formatted by the page. */
	moneySummaryKeys?: string[];
	rowMeta?: (RowMeta | null)[];
	/** Plain sentences shown under the title (basis of the figures, a truncation warning). */
	notices?: string[];
	/** A pass/fail line for a check the report itself makes (debits = credits, assets = L + E). */
	check?: { ok: boolean; text: string };
	tieOut?: TieOutView;
	/** General ledger only. */
	accountOptions?: { id: string; code: string; name: string; type: string }[];
	accountId?: string;
	/** Shown instead of an empty table. */
	emptyMessage?: string;
	/** Trial balance only: whether zero-activity accounts are included. */
	showAll?: boolean;
}

export async function runReport(
	hotelId: string,
	slug: string,
	opts: { timezone: string; date?: string; from?: string; to?: string; account?: string; all?: boolean }
): Promise<RunReportResult | null> {
	const meta = REPORTS.find((r) => r.slug === slug);
	if (!meta) return null;
	const today = businessDateFor(opts.timezone);
	const date = opts.date || today;
	const from = opts.from || `${today.slice(0, 7)}-01`;
	const to = opts.to || today;

	switch (slug) {
		case 'trial-balance': {
			const tb = buildTrialBalance(await accountSums(hotelId, from, to), { showAll: opts.all });
			const tie = await cashLedgerTieOut(db, hotelId);
			const rows: (string | number)[][] = tb.lines.map((l) => [l.code, l.name, peso(l.debit), peso(l.credit)]);
			const rowMeta: (RowMeta | null)[] = tb.lines.map(() => null);
			if (tb.lines.length > 0) {
				rows.push(['', 'Total', peso(tb.totalDebit), peso(tb.totalCredit)]);
				rowMeta.push({ kind: 'total' });
			}
			return {
				name: meta.name,
				kind: 'range',
				columns: ['Code', 'Account', 'Debit', 'Credit'],
				moneyColumns: [2, 3],
				moneySummaryKeys: ['Total debits', 'Total credits'],
				rows,
				rowMeta,
				showAll: !!opts.all,
				summary: [
					['From', from],
					['To', to],
					['Total debits', peso(tb.totalDebit)],
					['Total credits', peso(tb.totalCredit)]
				],
				check: tb.balanced
					? { ok: true, text: 'Balanced — debits equal credits.' }
					: { ok: false, text: `Out of balance by ₱${peso(Math.abs(tb.difference))} — an entry was written outside the ledger's posting path.` },
				tieOut: {
					ok: tie.every((t) => t.ok),
					checked: tie.length,
					failing: tie
						.filter((t) => !t.ok)
						.map((t) => ({ name: t.name, stored: peso(t.storedCentavos), ledger: peso(t.ledgerCentavos), reasons: t.reasons }))
				},
				emptyMessage: 'No ledger activity in this period. Entries appear as payments and expenses are recorded.'
			};
		}
		case 'income-statement': {
			const s = buildIncomeStatement(await accountSums(hotelId, from, to));
			const rows: (string | number)[][] = [];
			const rowMeta: (RowMeta | null)[] = [];
			const section = (label: string, lines: StatementLine[], totalLabel: string, total: number) => {
				rows.push([label, '', '']);
				rowMeta.push({ kind: 'section' });
				for (const l of lines) {
					rows.push([l.code, l.name, peso(l.amountCentavos)]);
					rowMeta.push(null);
				}
				rows.push(['', totalLabel, peso(total)]);
				rowMeta.push({ kind: 'subtotal' });
			};
			const hasActivity = s.income.length > 0 || s.expenses.length > 0;
			if (hasActivity) {
				section('Income', s.income, 'Total income', s.totalIncome);
				section('Expenses', s.expenses, 'Total expenses', s.totalExpenses);
				rows.push(['', s.netIncome < 0 ? 'Net loss' : 'Net income', peso(s.netIncome)]);
				rowMeta.push({ kind: 'total' });
			}
			return {
				name: meta.name,
				kind: 'range',
				columns: ['Code', 'Account', 'Amount'],
				moneyColumns: [2],
				moneySummaryKeys: ['Total income', 'Total expenses', 'Net income', 'Net loss'],
				rows,
				rowMeta,
				notices: ['Cash basis — income and expenses are counted when the cash moves, not when a booking is made or a bill is issued.'],
				summary: [
					['From', from],
					['To', to],
					['Total income', peso(s.totalIncome)],
					['Total expenses', peso(s.totalExpenses)],
					[s.netIncome < 0 ? 'Net loss' : 'Net income', peso(s.netIncome)]
				],
				emptyMessage: 'No income or expenses in this period. They appear as payments and expenses are recorded.'
			};
		}
		case 'balance-sheet': {
			const bs = buildBalanceSheet(await accountSums(hotelId, null, to));
			const rows: (string | number)[][] = [];
			const rowMeta: (RowMeta | null)[] = [];
			const section = (label: string, lines: StatementLine[], totalLabel: string, total: number, extra?: (string | number)[]) => {
				rows.push([label, '', '']);
				rowMeta.push({ kind: 'section' });
				for (const l of lines) {
					rows.push([l.code, l.name, peso(l.amountCentavos)]);
					rowMeta.push(null);
				}
				if (extra) {
					rows.push(extra);
					rowMeta.push(null);
				}
				rows.push(['', totalLabel, peso(total)]);
				rowMeta.push({ kind: 'subtotal' });
			};
			const hasActivity = bs.assets.length + bs.liabilities.length + bs.equity.length > 0 || bs.earningsToDate !== 0;
			if (hasActivity) {
				section('Assets', bs.assets, 'Total assets', bs.totalAssets);
				section('Liabilities', bs.liabilities, 'Total liabilities', bs.totalLiabilities);
				section('Equity', bs.equity, 'Total equity', bs.totalEquity, ['', 'Earnings to date', peso(bs.earningsToDate)]);
				rows.push(['', 'Total liabilities & equity', peso(bs.totalLiabilities + bs.totalEquity)]);
				rowMeta.push({ kind: 'total' });
			}
			return {
				name: meta.name,
				kind: 'asOf',
				columns: ['Code', 'Account', 'Amount'],
				moneyColumns: [2],
				moneySummaryKeys: ['Total assets', 'Total liabilities & equity'],
				rows,
				rowMeta,
				notices: [
					'Cash basis — receivables and unearned revenue are not on the books, so this shows cash and what the owner has put in or taken out. “Earnings to date” is all income less all expenses through this date.'
				],
				summary: [
					['As of', to],
					['Total assets', peso(bs.totalAssets)],
					['Total liabilities & equity', peso(bs.totalLiabilities + bs.totalEquity)]
				],
				check: bs.balanced
					? { ok: true, text: 'Balanced — assets equal liabilities plus equity.' }
					: { ok: false, text: `Out of balance by ₱${peso(Math.abs(bs.difference))} — the ledger contains an entry that doesn't balance.` },
				emptyMessage: 'Nothing on the books yet. Balances appear as payments and expenses are recorded.'
			};
		}
		case 'general-ledger': {
			const accounts = await listLedgerAccounts(hotelId);
			// Default to the front desk drawer (1010): the account staff most often ask "why did this move?" about.
			const chosen =
				accounts.find((a) => a.id === opts.account) ?? accounts.find((a) => a.code === '1010') ?? accounts[0];
			if (!chosen) {
				return {
					name: meta.name,
					kind: 'range',
					columns: ['Date', 'Entry', 'Description', 'Debit', 'Credit', 'Balance'],
					rows: [],
					summary: [],
					accountOptions: [],
					emptyMessage: 'This hotel has no chart of accounts yet.'
				};
			}
			const gl = await generalLedgerPage(hotelId, chosen.id, from, to, GENERAL_LEDGER_ROW_LIMIT);
			const rows: (string | number)[][] = [];
			const rowMeta: (RowMeta | null)[] = [];
			if (gl.rows.length > 0 || gl.openingCentavos !== 0) {
				rows.push(['', '', 'Opening balance', '', '', peso(gl.openingCentavos)]);
				rowMeta.push({ kind: 'opening' });
			}
			for (const r of gl.rows) {
				rows.push([r.date, r.entryNo, r.memo || labelSource(r.sourceType), peso(r.debitCentavos), peso(r.creditCentavos), peso(r.runningBalanceCentavos)]);
				rowMeta.push({
					link: r.link ?? undefined,
					detail: r.lines.map((l) => ({ code: l.code, name: l.name, debit: peso(l.debitCentavos), credit: peso(l.creditCentavos) }))
				});
			}
			return {
				name: meta.name,
				kind: 'range',
				columns: ['Date', 'Entry', 'Description', 'Debit', 'Credit', 'Balance'],
				moneyColumns: [3, 4, 5],
				moneySummaryKeys: ['Opening balance', 'Total debits', 'Total credits', 'Closing balance'],
				rows,
				rowMeta,
				accountOptions: accounts,
				accountId: chosen.id,
				notices: gl.truncated
					? [`Showing the first ${GENERAL_LEDGER_ROW_LIMIT} entries. The totals and closing balance cover the whole period — narrow the dates to see the rest.`]
					: [],
				summary: [
					['Account', `${gl.account.code} ${gl.account.name}`],
					['From', from],
					['To', to],
					['Opening balance', peso(gl.openingCentavos)],
					['Total debits', peso(gl.totalDebitCentavos)],
					['Total credits', peso(gl.totalCreditCentavos)],
					['Closing balance', peso(gl.closingCentavos)]
				],
				emptyMessage: 'No entries for this account in this period.'
			};
		}
		case 'quick-sales': {
			const r = await quickSalesReport(hotelId, from, to);
			const fmtTime = (d: Date) =>
				new Intl.DateTimeFormat('en-PH', { timeZone: opts.timezone, hour: 'numeric', minute: '2-digit' }).format(d);
			return {
				name: meta.name,
				kind: 'range',
				columns: ['Date', 'Time', 'Items', 'Method', 'Amount'],
				rows: r.rows.map((x) => [x.businessDate, fmtTime(x.createdAt), x.itemsSummary, x.method, peso(x.totalCentavos)]),
				summary: [
					['From', from],
					['To', to],
					['Sales', String(r.rows.length)],
					['Total', peso(r.totalCentavos)]
				]
			};
		}
		case 'daily-sales': {
			const r = await dailySalesReport(hotelId, date);
			return {
				name: meta.name,
				kind: 'day',
				columns: ['Line', 'Amount'],
				rows: [
					...r.revenueBySource.map(
						(s) => [labelSource(s.source), peso(s.amountCentavos)] as (string | number)[]
					),
					['Deposits taken', peso(r.depositsCentavos)],
					['Refunds', `-${peso(r.refundsCentavos)}`],
					['—', '—'],
					...r.byMethod.map(
						(m) =>
							[`Tender · ${m.method} (${m.count})`, peso(m.amountCentavos)] as (string | number)[]
					)
				],
				summary: [
					['Date', date],
					['Gross revenue', peso(r.grossRevenueCentavos)],
					['Net cash', peso(r.netCashCentavos)]
				]
			};
		}
		case 'cash-position': {
			const rows = await cashPositionReport(hotelId, from, to);
			return {
				name: meta.name,
				kind: 'range',
				columns: ['Account', 'Opening', 'In', 'Out', 'Closing'],
				rows: rows.map((a) => [
					a.name,
					peso(a.openingCentavos),
					peso(a.inCentavos),
					peso(a.outCentavos),
					peso(a.closingCentavos)
				]),
				summary: [
					['From', from],
					['To', to],
					['Total closing', peso(rows.reduce((s, a) => s + a.closingCentavos, 0))]
				]
			};
		}
		case 'cashflow': {
			const r = await cashflowReport(hotelId, from, to);
			return {
				name: meta.name,
				kind: 'range',
				columns: ['Direction', 'Category', 'Count', 'Amount'],
				rows: r.rows.map((x) => [
					x.direction,
					labelSource(x.category),
					x.count,
					peso(x.amountCentavos)
				]),
				summary: [
					['From', from],
					['To', to],
					['Total in', peso(r.totalInCentavos)],
					['Total out', peso(r.totalOutCentavos)],
					['Net', peso(r.totalInCentavos - r.totalOutCentavos)]
				]
			};
		}
		case 'revenue-by-source': {
			const r = await revenueBySourceReport(hotelId, from, to);
			return {
				name: meta.name,
				kind: 'range',
				columns: ['Source', 'Amount'],
				rows: r.rows.map((x) => [labelSource(x.source), peso(x.amountCentavos)]),
				summary: [
					['From', from],
					['To', to],
					['Total', peso(r.totalCentavos)]
				]
			};
		}
		case 'expenses': {
			const r = await expenseReport(hotelId, from, to);
			return {
				name: meta.name,
				kind: 'range',
				columns: ['Group', 'Category', 'Count', 'Gross', 'Input VAT'],
				rows: r.rows.map((x) => [
					x.group,
					x.categoryName,
					x.count,
					peso(x.grossCentavos),
					peso(x.inputVatCentavos)
				]),
				summary: [
					['From', from],
					['To', to],
					['Total gross', peso(r.totalGrossCentavos)],
					['Total input VAT', peso(r.totalInputVatCentavos)]
				]
			};
		}
		case 'payment-methods': {
			const r = await paymentMethodBreakdown(hotelId, from, to);
			return {
				name: meta.name,
				kind: 'range',
				columns: ['Method', 'Count', 'Amount'],
				rows: r.rows.map((x) => [x.method, x.count, peso(x.amountCentavos)]),
				summary: [
					['From', from],
					['To', to],
					['Total', peso(r.totalCentavos)]
				]
			};
		}
		case 'ar-aging': {
			const r = await arAgingReport(hotelId, to);
			return {
				name: meta.name,
				kind: 'asOf',
				columns: ['Bucket', 'Accounts', 'Amount'],
				rows: r.buckets.map((b) => [b.label, b.count, peso(b.amountCentavos)]),
				summary: [
					['As of', to],
					['Total outstanding', peso(r.totalCentavos)]
				]
			};
		}
		default:
			return null;
	}
}

export function reportCsv(result: RunReportResult): string {
	const summaryRows = result.summary.map(([k, v]) => [k, v] as (string | number)[]);
	return toCsv([result.name, ''], [...summaryRows, ['', ''], result.columns, ...result.rows]);
}

function labelSource(s: string): string {
	return (
		(
			{
				room_revenue: 'Rooms',
				hall_revenue: 'Function halls',
				incidental_sale: 'Incidentals',
				other_revenue: 'Other revenue',
				deposit: 'Deposits',
				deposit_refund: 'Deposit refunds',
				refund: 'Refunds',
				expense: 'Expenses',
				payroll: 'Payroll',
				statutory_remittance: 'Statutory remittance',
				bank_deposit: 'Bank deposit',
				transfer_in: 'Transfer in',
				transfer_out: 'Transfer out',
				owner_contribution: 'Owner contribution',
				owner_draw: 'Owner draw',
				adjustment: 'Adjustment'
			} as Record<string, string>
		)[s] ?? s
	);
}
