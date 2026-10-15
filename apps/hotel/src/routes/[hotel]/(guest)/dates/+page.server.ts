import { getStorefrontAvailability } from '$lib/server/availability';
import { todayInTimezone } from '$lib/server/front-desk';
import type { PageServerLoad } from './$types';

/** How far ahead the calendar shows availability. */
const CALENDAR_DAYS = 365;

/** Wizard Step 1 — collects dates + occupancy on an inline two-month calendar. Query params
 *  pre-fill it (e.g. the Booking Summary sidebar's "Guests" Edit link returns here with current
 *  values); `/rooms` still does the real availability query once dates are submitted. The
 *  calendar's free / few / full states come from the same `getStorefrontAvailability` the
 *  homepage uses. */
export const load: PageServerLoad = async ({ url, locals }) => {
	const today = todayInTimezone(locals.hotel!.timezone);
	const availability = await getStorefrontAvailability(locals.hotel!.id, today, CALENDAR_DAYS);

	return {
		roomTypeId: url.searchParams.get('roomTypeId'),
		checkIn: url.searchParams.get('checkIn'),
		checkOut: url.searchParams.get('checkOut'),
		adults: Number(url.searchParams.get('adults') ?? 2) || 2,
		children: Number(url.searchParams.get('children') ?? 0) || 0,
		accessibleOnly: url.searchParams.get('accessible') === '1',
		/** The hotel's own "today" — the calendar's first pickable day. */
		today,
		dayAvailability: availability.days
	};
};
