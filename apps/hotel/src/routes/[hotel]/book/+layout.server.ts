import { error } from '@sveltejs/kit';
import { DEFAULT_ACCENT_COLOR, DEFAULT_PAPER_COLOR, parseBranding } from '$lib/server/branding';
import { darken, lighten, wovenPatternDataUri } from '$lib/woven-pattern';
import { listFunctionHalls } from '$lib/server/hall-availability';
import { listApprovedReviews } from '$lib/server/reviews';
import { listDiningItems, parseDiningConfig } from '$lib/server/dining';
import { listHotelAmenities } from '$lib/server/availability';
import { expirePendingOrders } from '$lib/server/orders';
import type { LayoutServerLoad } from './$types';

/** Shared across every page under book/ — the storefront nav (now a shared component reused
 *  by the homepage, Dining, Meetings & Events, and Contact) needs `functionHalls`/`reviews`/
 *  `diningItems`/`hotelAmenities` to decide which optional nav links to show, regardless of
 *  which page renders it. */
export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.hotel) error(404, 'Hotel not found');

	const branding = parseBranding(locals.hotel.config);
	const accent = branding.accentColor ?? DEFAULT_ACCENT_COLOR;
	const paper = branding.paperColor ?? DEFAULT_PAPER_COLOR;
	const hotelId = locals.hotel.id;

	// Opportunistic release of expired unpaid holds so availability shown below is
	// current. Fire-and-forget — never let a sweep failure or its latency touch the
	// storefront render.
	void expirePendingOrders({ hotelId }).catch((e) =>
		console.error('book layout: expirePendingOrders failed', e)
	);

	const [functionHalls, reviews, diningItems, hotelAmenities] = await Promise.all([
		listFunctionHalls(hotelId),
		listApprovedReviews(hotelId),
		listDiningItems(hotelId),
		listHotelAmenities(hotelId)
	]);
	const dining = parseDiningConfig(locals.hotel.config);

	return {
		hotel: {
			slug: locals.hotel.slug,
			name: locals.hotel.name,
			city: locals.hotel.city,
			currency: locals.hotel.currency,
			vatRateBps: locals.hotel.vatRateBps
		},
		branding,
		theme: {
			accent,
			accentLight: lighten(accent, 0.55),
			accentDeep: darken(accent, 0.3),
			patternUri: wovenPatternDataUri(accent),
			paper,
			/** Section bands/zebra rows — a shade deeper than `paper`, same relationship the
			    fixed default tokens had (`--ledger-paper-2` ~3% darker than `--ledger-paper`),
			    just computed from whatever paper tone the hotel actually picked. */
			paperDeep: darken(paper, 0.03)
		},
		functionHalls,
		reviews,
		diningItems,
		dining,
		hotelAmenities
	};
};
