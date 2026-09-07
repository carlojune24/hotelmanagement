import type { PageServerLoad } from './$types';

/** Wizard Step 1 — collects dates + occupancy. Pure query-param echo for pre-fill (e.g. the
 *  Booking Summary sidebar's "Guests" Edit link returns here with current values); no DB
 *  access needed, `/book/rooms` does the real availability query once dates are submitted. */
export const load: PageServerLoad = async ({ url }) => {
	return {
		roomTypeId: url.searchParams.get('roomTypeId'),
		checkIn: url.searchParams.get('checkIn'),
		checkOut: url.searchParams.get('checkOut'),
		adults: Number(url.searchParams.get('adults') ?? 2) || 2,
		children: Number(url.searchParams.get('children') ?? 0) || 0,
		accessibleOnly: url.searchParams.get('accessible') === '1'
	};
};
