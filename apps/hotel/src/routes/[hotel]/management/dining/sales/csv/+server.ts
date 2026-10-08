import { toCsv } from '$lib/server/finance/calc';
import { requireCap } from '$lib/server/auth/rbac';
import { diningSalesReport } from '$lib/server/dining-orders';
import { localParts } from '$lib/dining-slots';
import { resolveRange } from '$lib/dining-sales-range';
import type { RequestHandler } from './$types';

const php = (c: number) => (c / 100).toFixed(2);

/** The Sales tab as a CSV: summary, then each breakdown under its own heading. */
export const GET: RequestHandler = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'dining:read');
	const hotelId = locals.hotel!.id;
	const today = localParts(new Date(), locals.hotel!.timezone).date;
	const { from, to } = resolveRange(url, today);
	const venue = url.searchParams.get('venue');
	const r = await diningSalesReport(hotelId, from, to, venue && /^[0-9a-f-]{36}$/i.test(venue) ? venue : null);

	const csv = toCsv(
		['Dining sales', `${from} to ${to}`],
		[
			['Orders paid', r.orders],
			['Sales (VAT included)', php(r.grossCentavos)],
			['VAT included', php(r.vatCentavos)],
			['', ''],
			['By day', ''],
			['Date', 'Orders', 'Sales'],
			...r.byDay.map((d) => [d.date, d.orders, php(d.grossCentavos)]),
			['', ''],
			['By venue', ''],
			['Venue', 'Orders', 'Sales'],
			...r.byVenue.map((v) => [v.venue, v.orders, php(v.grossCentavos)]),
			['', ''],
			['By station', ''],
			['Station', 'Quantity', 'Sales'],
			...r.byStation.map((st) => [st.station, st.quantity, php(st.grossCentavos)]),
			['', ''],
			['By dish', ''],
			['Dish', 'Quantity', 'Sales'],
			...r.byItem.map((i) => [i.name, i.quantity, php(i.grossCentavos)]),
			['', ''],
			['By payment method', ''],
			['Method', 'Orders', 'Sales'],
			...r.byMethod.map((m) => [m.method, m.orders, php(m.grossCentavos)])
		]
	);

	return new Response(csv, {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="dining-sales-${from}-to-${to}.csv"`,
			'cache-control': 'no-store'
		}
	});
};
