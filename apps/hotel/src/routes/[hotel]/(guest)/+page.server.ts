import { getStorefrontAvailability, listBrowsableRoomTypes, searchAvailability } from '$lib/server/availability';
import { todayInTimezone } from '$lib/server/front-desk';
import type { PageServerLoad } from './$types';

/** How far ahead the date picker shows availability. */
const CALENDAR_DAYS = 365;
const MAX_NIGHTS = 30;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const nightsBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** The storefront homepage. With no query it is pure marketing data. With `?checkIn&checkOut[&adults&children]`
 *  (set by the booking bar) the Rooms section turns into live availability: the same `searchAvailability`
 *  the wizard's Rooms & Rates step uses, so prices and what is bookable match exactly. Bad or past dates are
 *  ignored rather than erroring; the page just renders undated. `functionHalls`/`reviews`/`hotelAmenities`
 *  come from the shared layout load. */
export const load: PageServerLoad = async ({ locals, url }) => {
	const hotelId = locals.hotel!.id;
	const today = todayInTimezone(locals.hotel!.timezone);

	const checkIn = url.searchParams.get('checkIn') ?? '';
	const checkOut = url.searchParams.get('checkOut') ?? '';
	const adults = Math.min(10, Math.max(1, Number(url.searchParams.get('adults') ?? 2) || 2));
	const children = Math.min(10, Math.max(0, Number(url.searchParams.get('children') ?? 0) || 0));
	const validStay =
		ISO_DATE.test(checkIn) &&
		ISO_DATE.test(checkOut) &&
		checkIn >= today &&
		checkOut > checkIn &&
		nightsBetween(checkIn, checkOut) <= MAX_NIGHTS;

	const [browsableRoomTypes, availability, results] = await Promise.all([
		listBrowsableRoomTypes(hotelId),
		getStorefrontAvailability(hotelId, today, CALENDAR_DAYS),
		validStay
			? searchAvailability({ hotelId, checkIn, checkOut, occupancy: adults + children, accessibleOnly: false })
			: Promise.resolve(null)
	]);

	return {
		browsableRoomTypes,
		/** The hotel's own "today" — the calendar's first pickable day. */
		today,
		/** One entry per night for the next year: free / few left / full. */
		dayAvailability: availability.days,
		/** Per room type: rooms that exist and rooms free tonight, for the room cards. */
		stockByRoomType: availability.stockByRoomType,
		/** The guest's searched stay and what is bookable for it; null when no valid dates were given. */
		stay: validStay
			? { checkIn, checkOut, adults, children, nights: nightsBetween(checkIn, checkOut) }
			: null,
		liveRooms: results ?? []
	};
};
