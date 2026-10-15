import { error } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { toCsv } from '$lib/server/finance/calc';
import { listPaymongoLedger, parseLedgerFilter } from '$lib/server/finance/paymongo-ledger';
import type { RequestHandler } from './$types';

const KIND_LABEL: Record<string, string> = { payment: 'Payment', refund: 'Refund', payout: 'Payout' };
const pesos = (c: number) => (c / 100).toFixed(2);

/** The PayMongo tab's current filters as a spreadsheet: one line per PayMongo record. */
export const GET: RequestHandler = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	const hotel = locals.hotel!;
	const { rows } = await listPaymongoLedger(hotel.id, hotel.timezone, parseLedgerFilter(url), 5000);
	if (rows.length === 0 && url.searchParams.size === 0) error(404, 'Nothing to export yet');

	const when = (d: Date) =>
		new Intl.DateTimeFormat('en-CA', {
			timeZone: hotel.timezone,
			dateStyle: 'short',
			timeStyle: 'short',
			hour12: false
		}).format(d);

	const csv = toCsv(
		['Date', 'PayMongo ID', 'Type', 'Direction', 'Status', 'Method', 'Gross', 'Fee', 'Net', 'Reference', 'Payment ID', 'Payout ID', 'Guest', 'Booking / dining', 'Bank'],
		rows.map((r) => [
			when(r.occurredAt),
			r.paymongoId,
			KIND_LABEL[r.kind] ?? r.kind,
			r.direction === 'in' ? 'Incoming' : 'Outgoing',
			r.status,
			r.sourceType ?? '',
			pesos(r.grossCentavos),
			pesos(r.feeCentavos),
			pesos(r.netCentavos),
			r.reference ?? '',
			r.paymentId ?? '',
			r.payoutId ?? '',
			r.guestName ?? '',
			r.diningCode ?? r.orderId ?? '',
			r.bankName ? `${r.bankName}${r.accountLast4 ? ` ••••${r.accountLast4}` : ''}` : ''
		])
	);
	return new Response(csv, {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="paymongo-${new Date().toISOString().slice(0, 10)}.csv"`
		}
	});
};
