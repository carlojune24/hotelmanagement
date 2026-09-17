import { redirect } from '@sveltejs/kit';
import { searchAvailability } from '$lib/server/availability';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const checkIn = url.searchParams.get('checkIn');
	const checkOut = url.searchParams.get('checkOut');

	// This page is reachable from the bare homepage (dates only, no occupancy collected
	// there) as well as from the Dates step (full occupancy) — default to the same
	// baseline the homepage used to when occupancy isn't specified.
	const adults = Number(url.searchParams.get('adults') ?? 2) || 2;
	const children = Number(url.searchParams.get('children') ?? 0) || 0;
	const accessibleOnly = url.searchParams.get('accessible') === '1';
	const highlightRoomTypeId = url.searchParams.get('roomTypeId');
	const promo = url.searchParams.get('promo');

	if (!checkIn || !checkOut || checkIn >= checkOut) {
		// Nothing sane to show without valid dates — send the guest to collect them.
		redirect(303, `dates?${url.searchParams.toString()}`);
	}

	const hotelId = locals.hotel!.id;
	const results = await searchAvailability({
		hotelId,
		checkIn,
		checkOut,
		occupancy: adults + children,
		accessibleOnly
	});

	return {
		results,
		checkIn,
		checkOut,
		adults,
		children,
		accessibleOnly,
		highlightRoomTypeId,
		promo,
		nights: Math.round((+new Date(checkOut) - +new Date(checkIn)) / 86_400_000)
	};
};
