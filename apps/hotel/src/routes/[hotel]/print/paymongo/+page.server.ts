import { requireCap } from '$lib/server/auth/rbac';
import { getBirSettings } from '$lib/server/finance/documents';
import { listPaymongoLedger, parseLedgerFilter } from '$lib/server/finance/paymongo-ledger';
import { localParts } from '$lib/dining-slots';
import type { DocCell, ReportDoc } from '$lib/dining-report-doc';
import type { PageServerLoad } from './$types';

const LIMIT = 5000;
const KIND_LABEL: Record<string, string> = { payment: 'Payment', refund: 'Refund', payout: 'Payout' };
const SOURCE_LABEL = { all: 'Hotel and dining', hotel: 'Hotel bookings', dining: 'Dining' } as const;

/** The PayMongo tab as a printable sheet: same filters as the tab, every matching record listed. */
export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	const hotel = locals.hotel!;
	const f = parseLedgerFilter(url);
	const [{ rows, totals, truncated }, bir] = await Promise.all([
		listPaymongoLedger(hotel.id, hotel.timezone, f, LIMIT),
		getBirSettings(hotel.id)
	]);

	const when = (d: Date) => {
		const p = localParts(d, hotel.timezone);
		return `${p.date} ${p.time}`;
	};
	const period = f.from || f.to ? `${f.from ?? 'start'} to ${f.to ?? 'today'}` : 'All dates';
	const meta: [string, string][] = [['Source', SOURCE_LABEL[f.source]]];
	if (f.kind !== 'all') meta.push(['Type', KIND_LABEL[f.kind]!]);
	if (f.direction !== 'all') meta.push(['Direction', f.direction === 'in' ? 'Incoming' : 'Outgoing']);
	if (f.status !== 'all') meta.push(['Status', f.status.replace(/_/g, ' ')]);
	if (f.q) meta.push(['Search', f.q]);
	if (f.recon) meta.push(['Showing', 'Payments not linked to a booking']);

	const doc: ReportDoc = {
		title: 'PayMongo report',
		period,
		meta,
		summary: [
			{ label: 'Incoming (gross)', value: totals.inGross, kind: 'money' },
			{ label: 'PayMongo fees', value: totals.inFees, kind: 'money' },
			{ label: 'Incoming (net)', value: totals.inNet, kind: 'money' },
			{ label: 'Refunds out', value: totals.refundsOut, kind: 'money' },
			{ label: 'Paid out', value: totals.payoutsOut, kind: 'money' },
			{ label: 'Records', value: totals.count, kind: 'int' }
		],
		sections: [
			{
				title: 'Records',
				columns: [
					{ label: 'Date and time', kind: 'text' },
					{ label: 'Source', kind: 'text' },
					{ label: 'Type', kind: 'text' },
					{ label: 'Booking / order', kind: 'text' },
					{ label: 'Guest', kind: 'text' },
					{ label: 'Status', kind: 'text' },
					{ label: 'Gross', kind: 'money' },
					{ label: 'Fee', kind: 'money' },
					{ label: 'Net', kind: 'money' }
				],
				rows: rows.map((r): DocCell[] => [
					when(r.occurredAt),
					r.orderId ? 'Hotel' : r.diningOrderId ? 'Dining' : '',
					`${KIND_LABEL[r.kind] ?? r.kind}${r.sourceType ? ` (${r.sourceType})` : ''}`,
					r.diningCode ?? r.orderId?.slice(0, 8).toUpperCase() ?? (r.kind === 'payout' ? (r.bankName ?? '') : ''),
					r.guestName ?? '',
					r.status.replace(/_/g, ' '),
					r.grossCentavos,
					// Same as the tab: a payout's fee column is everything PayMongo kept back.
					r.kind === 'payout' ? r.grossCentavos - r.netCentavos : r.feeCentavos,
					r.netCentavos
				]),
				note: truncated ? `Newest ${rows.length} of ${totals.count} records. Narrow the dates to print the rest.` : undefined,
				emptyText: 'No PayMongo records match this filter.'
			}
		],
		notes: [
			"Taken from PayMongo's own records as last synced.",
			'Totals cover every record matching the filter. Payouts carry hotel and dining money together, so they only appear when the source is "Hotel and dining".'
		]
	};

	const now = localParts(new Date(), hotel.timezone);
	return {
		doc,
		hotelName: hotel.name,
		hotelTin: bir?.tin ?? null,
		printedAt: `${now.date} ${now.time}`,
		preparedBy: locals.user?.name ?? ''
	};
};
