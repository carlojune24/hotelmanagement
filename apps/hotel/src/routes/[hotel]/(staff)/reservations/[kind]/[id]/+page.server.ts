import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { getHallBookingDetail, getRoomBookingDetail } from '$lib/server/reservations';
import { CheckInError, checkInBooking, listEligibleRooms } from '$lib/server/front-desk';
import { sendBookingConfirmation } from '$lib/server/email/send-booking-confirmation';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	requireCap(locals.user, locals.role, 'booking:read');
	const hotelId = locals.hotel!.id;

	if (params.kind === 'room') {
		const detail = await getRoomBookingDetail(hotelId, params.id);
		if (!detail) error(404, 'Booking not found');

		const eligibleRooms =
			detail.booking.status === 'confirmed'
				? await listEligibleRooms(
						hotelId,
						detail.bookingRoom.roomTypeId,
						detail.booking.checkIn,
						detail.booking.checkOut
					)
				: [];

		return { kind: 'room' as const, detail, eligibleRooms };
	}
	if (params.kind === 'hall') {
		const detail = await getHallBookingDetail(hotelId, params.id);
		if (!detail) error(404, 'Booking not found');
		return { kind: 'hall' as const, detail };
	}
	error(404, 'Booking not found');
};

export const actions: Actions = {
	checkIn: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotelId = event.locals.hotel!.id;

		const raw = await event.request.formData();
		const parsed = z.array(z.string().uuid()).min(1).safeParse(raw.getAll('roomId'));
		if (!parsed.success) return fail(400, { error: 'Select a room for check-in.' });

		try {
			await checkInBooking(hotelId, event.params.id, parsed.data, event.locals.user);
			return { ok: 'Guest checked in.' };
		} catch (e) {
			if (e instanceof CheckInError) return fail(400, { error: e.message });
			throw e;
		}
	},

	resendConfirmation: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotelId = event.locals.hotel!.id;

		const detail =
			event.params.kind === 'room'
				? await getRoomBookingDetail(hotelId, event.params.id)
				: await getHallBookingDetail(hotelId, event.params.id);
		if (!detail) return fail(404, { error: 'Booking not found.' });

		if (detail.order.status !== 'confirmed') {
			return fail(400, { error: 'Only a confirmed booking has a confirmation to send.' });
		}

		const res = await sendBookingConfirmation(detail.order.id, { force: true });
		if (!res.ok) {
			return fail(502, { error: `Could not send: ${res.error ?? 'unknown error'}` });
		}
		return { ok: `Confirmation email sent to ${detail.guest.email}.` };
	}
};
