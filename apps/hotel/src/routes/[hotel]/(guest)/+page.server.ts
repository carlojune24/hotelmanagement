import { getStorefrontAvailability, listBrowsableRoomTypes, searchAvailability } from '$lib/server/availability';
import { todayInTimezone } from '$lib/server/front-desk';
import { MAX_ROOMS_PER_LINE } from '$lib/pricing-utils';
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

	// A party too big for one room of a type is also offered N rooms of it (4 guests → 2 × "Good for 2").
	// One extra search per distinct N — normally just N = 2. Only whole-room rates that fit without an
	// extra bed qualify: "Good for 1" × 2 is never offered for 2 guests.
	const party = adults + children;
	const roomsNeeded = new Set(
		browsableRoomTypes
			.map((t) => Math.ceil(party / Math.max(1, t.maxOccupancy)))
			.filter((n) => n >= 2 && n <= MAX_ROOMS_PER_LINE)
	);
	const splitRooms = validStay
		? (
				await Promise.all(
					[...roomsNeeded].map(async (roomCount) =>
						(await searchAvailability({ hotelId, checkIn, checkOut, occupancy: party, roomCount, accessibleOnly: false }))
							.filter((room) => Math.ceil(party / room.maxOccupancy) === roomCount)
							.map((room) => ({
								roomCount,
								party,
								room: {
									...room,
									ratePlans: room.ratePlans.filter(
										(p) => p.fitsParty && p.extraBedsNeeded === 0 && (p.maxGuests == null || p.maxGuests >= room.maxOccupancy)
									)
								}
							}))
							.filter((s) => s.room.ratePlans.length > 0)
					)
				)
			).flat()
		: [];

	return {
		browsableRoomTypes,
		/** Room types offered as several rooms for a party too big for one; see `splitRooms` above. */
		splitRooms,
		/** The hotel's own "today" — the calendar's first pickable day. */
		today,
		/** One entry per night for the next year: free / few left / full. */
		dayAvailability: availability.days,
		/** The same, per room type: a room card's own calendar crosses out the nights THAT room is sold out. */
		dayAvailabilityByRoomType: availability.daysByRoomType,
		/** Per room type: rooms that exist and rooms free tonight, for the room cards. */
		stockByRoomType: availability.stockByRoomType,
		/** The guest's searched stay and what is bookable for it; null when no valid dates were given. */
		stay: validStay
			? { checkIn, checkOut, adults, children, nights: nightsBetween(checkIn, checkOut) }
			: null,
		liveRooms: results ?? []
	};
};
