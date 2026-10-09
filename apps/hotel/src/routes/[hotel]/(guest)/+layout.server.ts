import { error } from '@sveltejs/kit';
import { guestTheme } from '$lib/server/guest-theme';
import { listFunctionHalls } from '$lib/server/hall-availability';
import { listApprovedReviews } from '$lib/server/reviews';
import { listDiningItems, parseDiningConfig } from '$lib/server/dining';
import { listPublicMenus } from '$lib/server/dining-menu';
import { expirePendingDiningOrders, loadOnlineOrderingConfig } from '$lib/server/dining-online';
import { listHotelAmenities } from '$lib/server/availability';
import { expirePendingOrders } from '$lib/server/orders';
import type { LayoutServerLoad } from './$types';

/** Shared across every guest booking page — the storefront nav (now a shared component reused
 *  by the homepage, Dining, Meetings & Events, and Contact) needs `functionHalls`/`reviews`/
 *  `diningItems`/`hotelAmenities` to decide which optional nav links to show, regardless of
 *  which page renders it. */
export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.hotel) error(404, 'Hotel not found');

	const { branding, theme } = guestTheme(locals.hotel.config);
	const hotelId = locals.hotel.id;

	// Opportunistic release of expired unpaid holds so availability shown below is
	// current. Fire-and-forget — never let a sweep failure or its latency touch the
	// storefront render.
	void expirePendingOrders({ hotelId }).catch((e) =>
		console.error('guest layout: expirePendingOrders failed', e)
	);

	// Same for online dining orders whose payment never arrived.
	void expirePendingDiningOrders({ hotelId }).catch((e) => console.error('guest layout: expirePendingDiningOrders failed', e));

	const [functionHalls, reviews, diningItems, hotelAmenities, diningMenus] = await Promise.all([
		listFunctionHalls(hotelId),
		listApprovedReviews(hotelId),
		listDiningItems(hotelId),
		listHotelAmenities(hotelId),
		listPublicMenus(hotelId)
	]);
	const dining = parseDiningConfig(locals.hotel.config);

	// Venues a guest can really order from right now (switched on, hours set, a way to pay).
	const orderableVenueIds: string[] = [];
	for (const v of diningItems.filter((d) => d.onlineOrdersEnabled)) {
		if ((await loadOnlineOrderingConfig(hotelId, v.id))?.enabled) orderableVenueIds.push(v.id);
	}

	return {
		hotel: {
			slug: locals.hotel.slug,
			timezone: locals.hotel.timezone,
			name: locals.hotel.name,
			city: locals.hotel.city,
			currency: locals.hotel.currency,
			vatRateBps: locals.hotel.vatRateBps
		},
		branding,
		theme,
		functionHalls,
		reviews,
		diningItems,
		dining,
		diningMenus,
		orderableVenueIds,
		hotelAmenities
	};
};
