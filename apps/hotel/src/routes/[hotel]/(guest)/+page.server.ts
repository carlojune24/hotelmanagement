import { getStorefrontAvailability, listBrowsableRoomTypes } from '$lib/server/availability';
import { todayInTimezone } from '$lib/server/front-desk';
import type { PageServerLoad } from './$types';

/** How far ahead the date picker shows availability. */
const CALENDAR_DAYS = 365;

/** The bare homepage — pure Persuade-mode marketing data. Dates/occupancy/room-search
 *  concerns all moved to the `dates`/`rooms` wizard steps; this page no longer branches
 *  on a search at all. `functionHalls`/`reviews`/`hotelAmenities` come from the shared
 *  layout load now (the storefront nav needs them on every guest booking page, not just
 *  this one). */
export const load: PageServerLoad = async ({ locals }) => {
	const hotelId = locals.hotel!.id;
	const today = todayInTimezone(locals.hotel!.timezone);

	const [browsableRoomTypes, availability] = await Promise.all([
		listBrowsableRoomTypes(hotelId),
		getStorefrontAvailability(hotelId, today, CALENDAR_DAYS)
	]);

	return {
		browsableRoomTypes,
		/** The hotel's own "today" — the calendar's first pickable day. */
		today,
		/** One entry per night for the next year: free / few left / full. */
		dayAvailability: availability.days,
		/** Per room type: rooms that exist and rooms free tonight, for the room cards. */
		stockByRoomType: availability.stockByRoomType
	};
};
