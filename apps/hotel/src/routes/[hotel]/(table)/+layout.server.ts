import { error } from '@sveltejs/kit';
import { guestTheme } from '$lib/server/guest-theme';
import type { LayoutServerLoad } from './$types';

/**
 * The table-ordering app is deliberately small: just the hotel's name, branding and colours. None of
 * the booking site's data (halls, reviews, amenities, menus) and none of its order-expiry sweeps, so a
 * guest at a table gets a fast page on mobile data.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.hotel) error(404, 'Hotel not found');
	const { branding, theme } = guestTheme(locals.hotel.config);
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
		theme
	};
};
