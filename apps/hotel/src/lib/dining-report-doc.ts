/**
 * The Dining Sales and Cashflow reports as a plain document: a title, a summary and a list of
 * ruled tables. The printed sheet and the CSV are both drawn from this one model, so they can
 * never disagree. Pure (no database, no SvelteKit) so it is easy to reason about.
 *
 * Money is integer centavos everywhere in the model; the printer and the CSV format it.
 */
import type { DiningSalesReport } from '$lib/server/dining-orders';
import type { DiningCashflowReport } from '$lib/server/dining-cashflow';

export type DocKind = 'text' | 'int' | 'money';
export type DocCell = string | number;

export interface DocColumn {
	label: string;
	kind: DocKind;
}

export interface DocSection {
	title: string;
	columns: DocColumn[];
	rows: DocCell[][];
	/** A totals row, one cell per column ('' where a total makes no sense). */
	total?: DocCell[];
	/** One line under the table, e.g. "25 highest-selling dishes". */
	note?: string;
	/** Shown instead of the table body when there are no rows. */
	emptyText?: string;
}

export interface ReportDoc {
	title: string;
	period: string;
	/** What `period` is called on the sheet; 'Period' when omitted (the trail uses 'Number'). */
	periodLabel?: string;
	/** Label / value lines under the title: venue, basis, … */
	meta: [string, string][];
	summary: { label: string; value: number; kind: DocKind }[];
	sections: DocSection[];
	/** Basis-of-preparation notes printed at the foot. */
	notes: string[];
}

const T = (label: string): DocColumn => ({ label, kind: 'text' });
const N = (label: string): DocColumn => ({ label, kind: 'int' });
const M = (label: string): DocColumn => ({ label, kind: 'money' });

export const METHOD_LABEL: Record<string, string> = {
	cash: 'Cash',
	card: 'Card',
	gcash: 'GCash',
	maya: 'Maya',
	paymongo: 'Online (PayMongo)',
	room_charge: 'Charged to room',
	room_folio: 'Room bill settled',
	bank_transfer: 'Bank transfer',
	cheque: 'Cheque',
	house_use: 'House use',
	unknown: 'Unknown'
};
const method = (m: string) => METHOD_LABEL[m] ?? m;

const ACCOUNT_KIND: Record<string, string> = {
	cash_drawer: 'Drawer',
	petty_cash: 'Petty cash',
	bank: 'Bank',
	e_wallet: 'E-wallet',
	undeposited: 'Undeposited'
};

const periodLabel = (from: string, to: string) => (from === to ? from : `${from} to ${to}`);

// ---------------------------------------------------------------------------

export function buildSalesDoc(r: DiningSalesReport, ctx: { venueLabel: string }): ReportDoc {
	const net = r.grossCentavos - r.vatCentavos;
	const stationQty = r.byStation.reduce((s, x) => s + x.quantity, 0);
	const stationGross = r.byStation.reduce((s, x) => s + x.grossCentavos, 0);
	return {
		title: 'Dining sales report',
		period: periodLabel(r.from, r.to),
		meta: [
			['Venue', ctx.venueLabel],
			['Basis', 'Orders paid, or charged to a room, by business date; VAT inclusive']
		],
		summary: [
			{ label: 'Orders paid', value: r.orders, kind: 'int' },
			{ label: 'Gross sales (VAT incl.)', value: r.grossCentavos, kind: 'money' },
			{ label: 'VAT included', value: r.vatCentavos, kind: 'money' },
			{ label: 'Net of VAT', value: net, kind: 'money' },
			{ label: 'Average order', value: r.orders ? Math.round(r.grossCentavos / r.orders) : 0, kind: 'money' }
		],
		sections: [
			{
				title: 'Sales by day',
				columns: [T('Date'), N('Orders'), M('Sales')],
				rows: r.byDay.map((d) => [d.date, d.orders, d.grossCentavos]),
				total: ['Total', r.orders, r.grossCentavos],
				emptyText: 'No paid orders in this period.'
			},
			{
				title: 'Sales by payment method',
				columns: [T('Method'), N('Orders'), M('Sales')],
				rows: r.byMethod.map((m) => [method(m.method), m.orders, m.grossCentavos]),
				total: ['Total', r.orders, r.grossCentavos]
			},
			{
				title: 'Sales by venue',
				columns: [T('Venue'), N('Orders'), M('Sales')],
				rows: r.byVenue.map((v) => [v.venue, v.orders, v.grossCentavos]),
				total: ['Total', r.orders, r.grossCentavos]
			},
			{
				title: 'Sales by station',
				columns: [T('Station'), N('Items'), M('Sales')],
				rows: r.byStation.map((s) => [s.station, s.quantity, s.grossCentavos]),
				total: ['Total', stationQty, stationGross],
				note: 'Dish lines plus the delivery fee. Stations add up to gross sales.'
			},
			{
				title: 'Top dishes',
				columns: [T('Dish'), N('Quantity'), M('Sales')],
				rows: r.byItem.map((i) => [i.name, i.quantity, i.grossCentavos]),
				note: 'The highest-selling dishes in this period, by sales.'
			}
		],
		notes: [
			'Amounts are in Philippine pesos and include VAT.',
			'A voided payment is taken back out. A partial refund is not netted here; see the Cashflow report for money actually refunded.',
			'An order charged to a room counts on the day it was charged. Finance books it as dining income when the guest pays the room bill.'
		]
	};
}

// ---------------------------------------------------------------------------

export function buildCashflowDoc(r: DiningCashflowReport, ctx: { from: string; to: string; timezone: string }): ReportDoc {
	const time = (d: Date | string) =>
		new Intl.DateTimeFormat('en-CA', {
			timeZone: ctx.timezone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23'
		})
			.format(new Date(d))
			.replace(',', '');
	const net = (inC: number, outC: number) => inC - outC;
	const movementIn = r.movements.filter((m) => m.direction === 'in').reduce((s, m) => s + m.amountCentavos, 0);
	const movementOut = r.movements.filter((m) => m.direction === 'out').reduce((s, m) => s + m.amountCentavos, 0);

	const sections: DocSection[] = [
		{
			title: 'Cashflow by day',
			columns: [T('Date'), M('Money in'), M('Refunds out'), M('Net')],
			rows: r.byDay.map((d) => [d.date, d.inCentavos, d.refundCentavos, net(d.inCentavos, d.refundCentavos)]),
			total: ['Total', r.totals.inCentavos, r.totals.refundCentavos, r.totals.netCentavos],
			emptyText: 'No dining money moved in this period.'
		},
		{
			title: 'Where the money sits',
			columns: [T('Account'), T('Type'), M('Money in'), M('Refunds out'), M('Net')],
			rows: r.byAccount.map((a) => [
				a.name,
				ACCOUNT_KIND[a.kind] ?? a.kind,
				a.inCentavos,
				a.refundCentavos,
				net(a.inCentavos, a.refundCentavos)
			]),
			total: ['Total', '', r.totals.inCentavos, r.totals.refundCentavos, r.totals.netCentavos]
		},
		{
			title: 'Cashflow by payment method',
			columns: [T('Method'), M('Money in'), M('Refunds out'), M('Net')],
			rows: r.byMethod.map((m) => [method(m.method), m.inCentavos, m.refundCentavos, net(m.inCentavos, m.refundCentavos)]),
			total: ['Total', r.totals.inCentavos, r.totals.refundCentavos, r.totals.netCentavos]
		},
		{
			title: 'Movements',
			columns: [T('Date and time'), T('Account'), T('Method'), T('Reference'), M('In'), M('Out')],
			rows: r.movements.map((m) => [
				time(m.occurredAt),
				m.account,
				method(m.method),
				m.orderCode ?? m.memo ?? '',
				m.direction === 'in' ? m.amountCentavos : 0,
				m.direction === 'out' ? m.amountCentavos : 0
			]),
			total: ['Total', '', '', '', movementIn, movementOut],
			emptyText: 'No movements in this period.'
		},
		{
			title: 'PayMongo payouts recorded',
			columns: [T('Date'), T('Paid into'), T('Reference'), M('Amount')],
			rows: r.payouts.map((p) => [p.businessDate, p.toAccount ?? '', p.memo ?? '', p.amountCentavos]),
			note: 'The 20 most recent payouts, whatever the period. Not limited to the dates above.',
			emptyText: 'No payouts recorded yet.'
		}
	];

	if (r.needsAttention.length > 0) {
		sections.push({
			title: 'Paid orders not in Finance',
			columns: [T('Order'), T('Date'), T('Method'), M('Total')],
			rows: r.needsAttention.map((o) => [o.code, o.businessDate ?? '', method(o.method ?? 'unknown'), o.totalCentavos]),
			note: 'Marked paid, but no cash movement stands behind them, so this money is missing from Finance.'
		});
	}

	return {
		title: 'Dining cashflow report',
		period: periodLabel(ctx.from, ctx.to),
		meta: [
			['Venue', 'All venues'],
			['Basis', 'Cash basis: money actually received and refunded, by the business date it was recorded']
		],
		summary: [
			{ label: 'Money in', value: r.totals.inCentavos, kind: 'money' },
			{ label: 'Refunds out', value: r.totals.refundCentavos, kind: 'money' },
			{ label: 'Net cashflow', value: r.totals.netCentavos, kind: 'money' },
			{ label: 'Online money awaiting payout (all time)', value: Math.max(0, r.awaitingPayout.centavos), kind: 'money' }
		],
		sections,
		notes: [
			'Amounts are in Philippine pesos. Money in is dining income booked to account 4040 (Food & Beverage Revenue).',
			'Online (PayMongo) payments are held in Undeposited Funds (1090) until the payout is recorded; "awaiting payout" is that balance, as of the time of printing.',
			'Orders charged to a room appear when the guest settles the room bill. Voided payments are excluded.'
		]
	};
}

// ---------------------------------------------------------------------------

const php = (c: number) => (c / 100).toFixed(2);

/** The document as CSV rows: title, details, summary, then every table under its own heading. */
export function docToCsv(doc: ReportDoc): { headers: string[]; rows: (string | number)[][] } {
	const cell = (v: DocCell, kind: DocKind) => (kind === 'money' && typeof v === 'number' ? php(v) : v);
	const rows: (string | number)[][] = [];
	for (const [k, v] of doc.meta) rows.push([k, v]);
	rows.push(['', '']);
	rows.push(['Summary', '']);
	for (const s of doc.summary) rows.push([s.label, s.kind === 'money' ? php(s.value) : s.value]);
	for (const sec of doc.sections) {
		rows.push(['', '']);
		rows.push([sec.title]);
		rows.push(sec.columns.map((c) => c.label));
		for (const row of sec.rows) rows.push(row.map((v, i) => cell(v, sec.columns[i]!.kind)));
		if (sec.total) rows.push(sec.total.map((v, i) => cell(v, sec.columns[i]!.kind)));
		if (sec.note) rows.push([sec.note]);
	}
	rows.push(['', '']);
	for (const n of doc.notes) rows.push([n]);
	return { headers: [doc.title, doc.period], rows };
}
