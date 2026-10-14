import { requireCap } from '$lib/server/auth/rbac';
import { todayInTimezone } from '$lib/server/front-desk';
import { listBookingTransactions } from '$lib/server/booking-transactions';
import { resolveRange } from '$lib/date-range';
import { filtersFromParams } from '$lib/booking-payment-status';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'booking:read');
	const hotel = locals.hotel!;
	const today = todayInTimezone(hotel.timezone);
	const range = resolveRange(
		url.searchParams.get('range'),
		url.searchParams.get('from'),
		url.searchParams.get('to'),
		today
	);
	const q = url.searchParams.get('q')?.trim() ?? '';
	const filters = filtersFromParams(url.searchParams);
	const rows = await listBookingTransactions(hotel.id, range, q, filters);
	return {
		range,
		q,
		filters,
		rows,
		totals: {
			count: rows.length,
			chargesCentavos: rows.reduce((s, r) => s + r.chargesCentavos, 0),
			paidCentavos: rows.reduce((s, r) => s + r.paidCentavos, 0),
			balanceCentavos: rows.reduce((s, r) => s + Math.max(0, r.balanceCentavos), 0)
		}
	};
};
