import { requireCap } from '$lib/server/auth/rbac';
import { toCsv } from '$lib/server/finance/calc';
import { listMovements, parseCashFilter } from '$lib/server/finance/cash';
import type { RequestHandler } from './$types';

const pesos = (c: number) => (c / 100).toFixed(2);
const SIDE_LABEL = { hotel: 'Hotel', dining: 'Dining', shared: 'Shared transfer' } as const;

/** Finance → Cash's movements under the current filters (Hotel / Dining, dates, account, direction) as a spreadsheet. */
export const GET: RequestHandler = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	const hotel = locals.hotel!;
	const f = parseCashFilter(url);
	const rows = await listMovements(hotel.id, { ...f, limit: 50_000 });

	const csv = toCsv(
		['Date', 'Side', 'Account', 'Category', 'Counterparty', 'Memo', 'In', 'Out', 'Voided'],
		rows.map((m) => [
			m.businessDate,
			SIDE_LABEL[m.side],
			m.accountName,
			m.category.replace(/_/g, ' '),
			m.counterpartyName ?? '',
			m.memo ?? '',
			m.direction === 'in' ? pesos(m.amountCentavos) : '',
			m.direction === 'out' ? pesos(m.amountCentavos) : '',
			m.voidedAt ? `yes${m.voidReason ? `: ${m.voidReason}` : ''}` : ''
		])
	);
	const name = ['cash', f.side, f.from, f.to].filter(Boolean).join('-');
	return new Response(csv, {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="${name}.csv"`
		}
	});
};
