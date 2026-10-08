import { error, fail } from '@sveltejs/kit';
import { ReservationError, getReservationForGuest, setReservationStatus } from '$lib/server/dining-reservations';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url, depends }) => {
	depends('app:dining-reservation');
	const token = url.searchParams.get('t');
	if (!token) error(404, 'Not found');
	const reservation = await getReservationForGuest(locals.hotel!.id, locals.hotel!.timezone, params.code, token);
	if (!reservation) error(404, 'Not found');

	return {
		reservation: {
			...reservation,
			startsAt: reservation.startsAt.toISOString(),
			endsAt: reservation.endsAt.toISOString()
		},
		// A guest can cancel their own table until it is seated; once it has started, call the venue.
		canCancel:
			(reservation.status === 'confirmed' || reservation.status === 'pending') &&
			reservation.startsAt.getTime() > Date.now(),
		token
	};
};

export const actions: Actions = {
	cancel: async ({ locals, params, url }) => {
		const token = url.searchParams.get('t') ?? '';
		const hotelId = locals.hotel!.id;
		const reservation = await getReservationForGuest(hotelId, locals.hotel!.timezone, params.code, token);
		if (!reservation) return fail(404, { error: 'We could not find that reservation.' });
		if (reservation.startsAt.getTime() <= Date.now()) {
			return fail(400, { error: 'This reservation has already started. Please call the restaurant.' });
		}
		try {
			await setReservationStatus({ hotelId, reservationId: reservation.id, to: 'cancelled' });
		} catch (e) {
			if (e instanceof ReservationError) return fail(400, { error: e.message });
			throw e;
		}
		return { cancelled: true };
	}
};
