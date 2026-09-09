import { businessDateFor } from './shared';
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

export const REPORTS = [
	{ slug: 'daily-sales', name: 'Daily sales', kind: 'day' },
	{ slug: 'cash-position', name: 'Cash position', kind: 'range' },
	{ slug: 'cashflow', name: 'Cashflow', kind: 'range' },
	{ slug: 'revenue-by-source', name: 'Revenue by source', kind: 'range' },
	{ slug: 'expenses', name: 'Expenses', kind: 'range' },
	{ slug: 'payment-methods', name: 'Payment methods', kind: 'range' },
	{ slug: 'ar-aging', name: 'City-ledger aging', kind: 'asOf' }
] as const;

export type ReportSlug = (typeof REPORTS)[number]['slug'];

const peso = (c: number) => (c / 100).toFixed(2);

export interface RunReportResult {
	name: string;
	kind: 'day' | 'range' | 'asOf';
	columns: string[];
	rows: (string | number)[][];
	/** Summary key/value pairs rendered above the table. */
	summary: [string, string][];
}

export async function runReport(
	hotelId: string,
	slug: string,
	opts: { timezone: string; date?: string; from?: string; to?: string }
): Promise<RunReportResult | null> {
	const meta = REPORTS.find((r) => r.slug === slug);
	if (!meta) return null;
	const today = businessDateFor(opts.timezone);
	const date = opts.date || today;
	const from = opts.from || `${today.slice(0, 7)}-01`;
	const to = opts.to || today;

	switch (slug) {
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
