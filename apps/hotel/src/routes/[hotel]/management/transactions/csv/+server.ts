import { requireCap } from '$lib/server/auth/rbac';
import { todayInTimezone } from '$lib/server/front-desk';
import { listBookingTransactionsForExport } from '$lib/server/booking-transactions';
import { bookingTransactionsCsv } from '$lib/server/booking-transactions-csv';
import { resolveRange } from '$lib/date-range';
import { filtersFromParams } from '$lib/booking-payment-status';
import type { RequestHandler } from './$types';

/** The Booking transactions list for the chosen range as a CSV (same range and search as the page). */
export const GET: RequestHandler = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'booking:read');
	const hotel = locals.hotel!;
	const range = resolveRange(
		url.searchParams.get('range'),
		url.searchParams.get('from'),
		url.searchParams.get('to'),
		todayInTimezone(hotel.timezone)
	);
	const q = url.searchParams.get('q')?.trim() ?? '';
	const rows = await listBookingTransactionsForExport(hotel.id, range, q, filtersFromParams(url.searchParams));

	return new Response(bookingTransactionsCsv(rows), {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="booking-transactions-${range.from}-to-${range.to}.csv"`,
			'cache-control': 'no-store'
		}
	});
};
