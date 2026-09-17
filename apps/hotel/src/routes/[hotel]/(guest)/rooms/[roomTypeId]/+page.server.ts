import { error } from '@sveltejs/kit';
import { getAvailableRoomType, getBrowsableRoomType } from '$lib/server/availability';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const hotelId = locals.hotel!.id;
	const checkIn = url.searchParams.get('checkIn');
	const checkOut = url.searchParams.get('checkOut');
	const adults = Number(url.searchParams.get('adults') ?? 2) || 2;
	const children = Number(url.searchParams.get('children') ?? 0) || 0;
	const accessibleOnly = url.searchParams.get('accessible') === '1';

	if (checkIn && checkOut && checkIn < checkOut) {
		const roomType = await getAvailableRoomType({
			hotelId,
			checkIn,
			checkOut,
			occupancy: adults + children,
			roomTypeId: params.roomTypeId,
			accessibleOnly
		});
		if (!roomType) error(404, 'Room type not found or not available for those dates');
		return {
			mode: 'dated' as const,
			roomType,
			checkIn,
			checkOut,
			adults,
			children,
			fromTotalCentavos: Math.min(...roomType.ratePlans.map((p) => p.price.totalCentavos))
		};
	}

	const roomType = await getBrowsableRoomType(hotelId, params.roomTypeId, { accessibleOnly });
	if (!roomType) error(404, 'Room type not found');
	return { mode: 'undated' as const, roomType, checkIn: null, checkOut: null, adults, children };
};
