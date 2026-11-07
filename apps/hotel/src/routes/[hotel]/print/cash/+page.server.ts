import { requireCap } from '$lib/server/auth/rbac';
import { getBirSettings } from '$lib/server/finance/documents';
import { listMovements, movementTotals, parseCashFilter } from '$lib/server/finance/cash';
import { listCashAccounts } from '$lib/server/finance/accounts';
import { localParts } from '$lib/dining-slots';
import type { DocCell, ReportDoc } from '$lib/dining-report-doc';
import type { PageServerLoad } from './$types';

const LIMIT = 5000;
const SIDE_LABEL = { hotel: 'Hotel', dining: 'Dining', shared: 'Shared transfer' } as const;

/** Finance → Cash's movements as a printable sheet: same filters as the page, every matching movement. */
export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	const hotel = locals.hotel!;
	const f = parseCashFilter(url);
	const [rows, totals, hotelTotals, diningTotals, accounts, bir] = await Promise.all([
		listMovements(hotel.id, { ...f, limit: LIMIT }),
		movementTotals(hotel.id, f),
		f.side ? null : movementTotals(hotel.id, { ...f, side: 'hotel' }),
		f.side ? null : movementTotals(hotel.id, { ...f, side: 'dining' }),
		listCashAccounts(hotel.id, { includeInactive: true }),
		getBirSettings(hotel.id)
	]);

	const meta: [string, string][] = [['Money', f.side ? SIDE_LABEL[f.side] : 'Hotel and dining']];
	if (f.cashAccountId) meta.push(['Account', accounts.find((a) => a.id === f.cashAccountId)?.name ?? '']);
	if (f.direction) meta.push(['Direction', f.direction === 'in' ? 'In' : 'Out']);
	if (f.includeVoided) meta.push(['Voided', 'Listed, not counted']);

	const summary: ReportDoc['summary'] = [
		{ label: 'In', value: totals.inCentavos, kind: 'money' },
		{ label: 'Out', value: totals.outCentavos, kind: 'money' },
		{ label: 'Net', value: totals.inCentavos - totals.outCentavos, kind: 'money' }
	];
	if (hotelTotals && diningTotals) {
		summary.push(
			{ label: 'Hotel net', value: hotelTotals.inCentavos - hotelTotals.outCentavos, kind: 'money' },
			{ label: 'Dining net', value: diningTotals.inCentavos - diningTotals.outCentavos, kind: 'money' }
		);
	}

	const doc: ReportDoc = {
		title: f.side ? `${SIDE_LABEL[f.side]} cash movements` : 'Cash movements',
		period: f.from || f.to ? `${f.from ?? 'start'} to ${f.to ?? 'today'}` : 'All dates',
		meta,
		summary,
		sections: [
			{
				title: 'Movements',
				columns: [
					{ label: 'Date', kind: 'text' },
					{ label: 'Side', kind: 'text' },
					{ label: 'Account', kind: 'text' },
					{ label: 'Category', kind: 'text' },
					{ label: 'Details', kind: 'text' },
					{ label: 'In', kind: 'money' },
					{ label: 'Out', kind: 'money' }
				],
				rows: rows.map((m): DocCell[] => [
					m.businessDate,
					SIDE_LABEL[m.side],
					m.accountName,
					m.category.replace(/_/g, ' '),
					`${m.counterpartyName ? `${m.counterpartyName} — ` : ''}${m.memo ?? ''}${m.voidedAt ? ' (voided)' : ''}`,
					m.direction === 'in' ? m.amountCentavos : 0,
					m.direction === 'out' ? m.amountCentavos : 0
				]),
				total: ['Total', '', '', '', '', totals.inCentavos, totals.outCentavos],
				note: totals.count > rows.length ? `Newest ${rows.length} of ${totals.count} movements listed; the totals cover all of them.` : undefined,
				emptyText: 'No movements match this filter.'
			}
		],
		notes: [
			'Hotel or dining is worked out from where the money came from (dining sales, refunds and payouts, expenses tagged Dining, the dining drawer), or as picked on a manual entry.',
			'Transfers between two shared accounts (bank, e-wallet, undeposited) are neither side and appear only under hotel and dining together. Voided movements never count.',
			'Account opening floats are not movements and are not listed here.'
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
