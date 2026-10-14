import { requireCap } from '$lib/server/auth/rbac';
import { todayInTimezone } from '$lib/server/front-desk';
import { listBookingTransactionsForExport } from '$lib/server/booking-transactions';
import { getBirSettings } from '$lib/server/finance/documents';
import { resolveRange } from '$lib/date-range';
import type { PageServerLoad } from './$types';

/** The Booking transactions register, printable: same range and search as the staff list. */
export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'booking:read');
	const hotel = locals.hotel!;
	const range = resolveRange(
		url.searchParams.get('range'),
		url.searchParams.get('from'),
		url.searchParams.get('to'),
		todayInTimezone(hotel.timezone)
	);
	const q = url.searchParams.get('q')?.trim() ?? '';
	const [rows, bir] = await Promise.all([
		listBookingTransactionsForExport(hotel.id, range, q),
		getBirSettings(hotel.id)
	]);
	return {
		range,
		q,
		rows,
		hotelName: hotel.name,
		hotelTin: bir?.tin ?? null,
		printedAt: new Date().toISOString().slice(0, 16).replace('T', ' ')
	};
};
