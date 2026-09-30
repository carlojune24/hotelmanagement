import { listBrowsableRoomTypes } from '$lib/server/availability';
import type { PageServerLoad } from './$types';

/** The bare homepage — pure Persuade-mode marketing data. Dates/occupancy/room-search
 *  concerns all moved to the `dates`/`rooms` wizard steps; this page no longer branches
 *  on a search at all. `functionHalls`/`reviews`/`hotelAmenities` come from the shared
 *  layout load now (the storefront nav needs them on every guest booking page, not just
 *  this one). */
export const load: PageServerLoad = async ({ locals }) => {
	const hotelId = locals.hotel!.id;

	const browsableRoomTypes = await listBrowsableRoomTypes(hotelId);

	return {
		browsableRoomTypes
	};
};
