import { businessDateFor } from './shared';
import {
	REPORT_SCOPES,
	arAgingReport,
	cashPositionReport,
	cashflowReport,
	dailySalesReport,
	expenseReport,
	paymentMethodBreakdown,
	revenueBySourceReport,
	scPwdInRange,
	toCsv,
	type ReportScope
} from './reports';
import { quickSalesReport } from './standalone-sales';

export const REPORTS = [
	{ slug: 'daily-sales', name: 'Daily sales', kind: 'day' },
	{ slug: 'quick-sales', name: 'Quick sales', kind: 'range' },
	{ slug: 'cash-position', name: 'Cash position', kind: 'range' },
	{ slug: 'cashflow', name: 'Cashflow', kind: 'range' },
	{ slug: 'revenue-by-source', name: 'Revenue by source', kind: 'range' },
	{ slug: 'expenses', name: 'Expenses', kind: 'range' },
	{ slug: 'payment-methods', name: 'Payment methods', kind: 'range' },
	{ slug: 'ar-aging', name: 'City-ledger aging', kind: 'asOf' }
] as const;

export type ReportSlug = (typeof REPORTS)[number]['slug'];

/** The reports that can be narrowed to Hotel or Dining. The others are not split by business line. */
export const SCOPED_REPORTS: readonly string[] = ['daily-sales', 'cashflow', 'revenue-by-source', 'payment-methods'];

const peso = (c: number) => (c / 100).toFixed(2);

/** Summary lines for SC/PWD discounts applied in the period. Information only: they explain why a room was
 *  billed less than its price and never change what was received. Nothing is added when there were none. */
const scPwdSummary = (x: { claims: number; discountCentavos: number; vatRemovedCentavos: number } | null): [string, string][] =>
	!x || x.claims === 0
		? []
		: [
				[`SC/PWD discounts applied (${x.claims}) — 20% part`, peso(x.discountCentavos)],
				['SC/PWD — VAT removed', peso(x.vatRemovedCentavos)]
			];

export interface RunReportResult {
	name: string;
	/** The business line this run covers; `all` for a report that is not split. */
	scope: ReportScope;
	kind: 'day' | 'range' | 'asOf';
	columns: string[];
	rows: (string | number)[][];
	/** Summary key/value pairs rendered above the table. */
	summary: [string, string][];
}

export async function runReport(
	hotelId: string,
	slug: string,
	opts: { timezone: string; date?: string; from?: string; to?: string; scope?: ReportScope }
): Promise<RunReportResult | null> {
	const meta = REPORTS.find((r) => r.slug === slug);
	if (!meta) return null;
	// Only the reports that can be split honour a scope; asking for one on the rest is ignored.
	const scope: ReportScope = SCOPED_REPORTS.includes(slug) ? (opts.scope ?? 'all') : 'all';
	const scopeName = REPORT_SCOPES.find((s) => s.key === scope)!.label;
	const scopedName = (n: string) => (scope === 'all' ? n : `${n} — ${scopeName}`);
	const scopeSummary = (): [string, string][] => (scope === 'all' ? [] : [['Scope', scopeName]]);
	const today = businessDateFor(opts.timezone);
	const date = opts.date || today;
	const from = opts.from || `${today.slice(0, 7)}-01`;
	const to = opts.to || today;

	switch (slug) {
		case 'quick-sales': {
			const r = await quickSalesReport(hotelId, from, to);
			const fmtTime = (d: Date) =>
				new Intl.DateTimeFormat('en-PH', { timeZone: opts.timezone, hour: 'numeric', minute: '2-digit' }).format(d);
			return {
				name: meta.name,
				scope,
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
			const r = await dailySalesReport(hotelId, date, scope);
			return {
				name: scopedName(meta.name),
				scope,
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
					...scopeSummary(),
					['Gross received', peso(r.grossRevenueCentavos)],
					['Less: refunds paid out', `-${peso(r.grossRevenueCentavos - r.netRevenueCentavos)}`],
					['Net income (kept)', peso(r.netRevenueCentavos)],
					...scPwdSummary(r.scPwd),
					// A scope's net is its takings less its refunds; expenses are not split by business line.
					[scope === 'all' ? 'Net cash' : 'Net of refunds', peso(r.netCashCentavos)]
				]
			};
		}
		case 'cash-position': {
			const rows = await cashPositionReport(hotelId, from, to);
			return {
				name: meta.name,
				scope,
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
			const r = await cashflowReport(hotelId, from, to, scope);
			return {
				name: scopedName(meta.name),
				scope,
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
					...scopeSummary(),
					['Total in', peso(r.totalInCentavos)],
					['Total out', peso(r.totalOutCentavos)],
					['Net', peso(r.totalInCentavos - r.totalOutCentavos)],
					...(scope === 'dining' ? [] : scPwdSummary(await scPwdInRange(hotelId, from, to)))
				]
			};
		}
		case 'revenue-by-source': {
			const r = await revenueBySourceReport(hotelId, from, to, scope);
			return {
				name: scopedName(meta.name),
				scope,
				kind: 'range',
				columns: ['Source', 'Amount'],
				rows: r.rows.map((x) => [labelSource(x.source), peso(x.amountCentavos)]),
				summary: [
					['From', from],
					['To', to],
					...scopeSummary(),
					['Gross received', peso(r.totalCentavos)],
					['Less: refunds paid out', `-${peso(r.refundsCentavos)}`],
					['Net income (kept)', peso(r.netCentavos)],
					...(scope === 'dining' ? [] : scPwdSummary(await scPwdInRange(hotelId, from, to)))
				]
			};
		}
		case 'expenses': {
			const r = await expenseReport(hotelId, from, to);
			return {
				name: meta.name,
				scope,
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
			const r = await paymentMethodBreakdown(hotelId, from, to, scope);
			return {
				name: scopedName(meta.name),
				scope,
				kind: 'range',
				columns: ['Method', 'Count', 'Amount'],
				rows: r.rows.map((x) => [x.method, x.count, peso(x.amountCentavos)]),
				summary: [
					['From', from],
					['To', to],
					...scopeSummary(),
					['Total', peso(r.totalCentavos)]
				]
			};
		}
		case 'ar-aging': {
			const r = await arAgingReport(hotelId, to);
			return {
				name: meta.name,
				scope,
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
				dining_revenue: 'Dining',
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
