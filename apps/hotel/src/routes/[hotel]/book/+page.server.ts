import { listBrowsableRoomTypes } from '$lib/server/availability';
import type { PageServerLoad } from './$types';

/** The bare homepage — pure Persuade-mode marketing data. Dates/occupancy/room-search
 *  concerns all moved to the `dates`/`rooms` wizard steps; this page no longer branches
 *  on a search at all. `functionHalls`/`reviews`/`hotelAmenities` come from the shared
 *  layout load now (the storefront nav needs them on every page under book/, not just
 *  this one). */
export const load: PageServerLoad = async ({ locals, url }) => {
	const hotelId = locals.hotel!.id;

	const browsableRoomTypes = await listBrowsableRoomTypes(hotelId);

	return {
		// Capture-and-display only — carried through the wizard as a query param, never sent
		// to `createOrder`, never affects price. There is no discount/promo engine in this app.
		promo: url.searchParams.get('promo'),
		browsableRoomTypes
	};
};
