import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import { roleCan } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import { getHallBookingDetail, getRoomBookingDetail } from '$lib/server/reservations';
import { CheckInError, checkInBooking, listEligibleRooms, todayInTimezone } from '$lib/server/front-desk';
import { sendBookingConfirmation } from '$lib/server/email/send-booking-confirmation';
import { sendBookingCancellation } from '$lib/server/email/send-booking-cancellation';
import {
	CancellationError,
	cancelBooking,
	getCancellationQuote,
	markNoShow,
	REFUND_METHODS
} from '$lib/server/cancellation';
import { sendGuestMessageReply } from '$lib/server/email/send-guest-message-reply';
import {
	GuestMessageError,
	declineCancellationRequest,
	getOpenRequest,
	listThread,
	markThreadReadByStaff,
	sendStaffReply
} from '$lib/server/guest-messages';
import {
	StatusOverrideError,
	manuallyConfirmOrder,
	reinstateBooking
} from '$lib/server/status-override';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCap(locals.user, locals.role, 'booking:read');
	const hotel = locals.hotel!;
	const hotelId = hotel.id;
	const actionHint = url.searchParams.get('action'); // 'cancel' | 'no-show', from a deep link
	// Reservation status override (manual-confirm / reinstate) is hotel_admin-only —
	// same double-gate `(staff)/finance`'s day-close reopen uses, not plain `booking:write`
	// (which `front_desk` already has).
	const canAdmin = locals.user?.isPlatformAdmin || (locals.role ? roleCan(locals.role, 'hotel:admin') : false);

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

		const cancellable = ['confirmed', 'pending_payment'].includes(detail.booking.status);
		const cancelQuote = cancellable
			? await getCancellationQuote(hotelId, { kind: 'room', bookingId: params.id })
			: null;
		const canMarkNoShow =
			detail.booking.status === 'confirmed' &&
			detail.booking.checkIn < todayInTimezone(hotel.timezone);

		const [thread, openRequest] = await Promise.all([
			listThread(detail.order.id),
			getOpenRequest({ kind: 'room', bookingId: params.id })
		]);
		await markThreadReadByStaff(detail.order.id);

		return {
			kind: 'room' as const,
			detail,
			eligibleRooms,
			cancelQuote,
			canMarkNoShow,
			canAdmin,
			thread,
			openRequest,
			autoOpen: actionHint === 'cancel' && cancelQuote ? 'cancel' : actionHint === 'no-show' && canMarkNoShow ? 'no-show' : null
		};
	}
	if (params.kind === 'hall') {
		const detail = await getHallBookingDetail(hotelId, params.id);
		if (!detail) error(404, 'Booking not found');

		const cancellable = ['confirmed', 'pending_payment'].includes(detail.hallBooking.status);
		const cancelQuote = cancellable
			? await getCancellationQuote(hotelId, { kind: 'hall', hallBookingId: params.id })
			: null;

		const [thread, openRequest] = await Promise.all([
			listThread(detail.order.id),
			getOpenRequest({ kind: 'hall', hallBookingId: params.id })
		]);
		await markThreadReadByStaff(detail.order.id);

		return {
			kind: 'hall' as const,
			detail,
			cancelQuote,
			canMarkNoShow: false,
			canAdmin,
			thread,
			openRequest,
			autoOpen: actionHint === 'cancel' && cancelQuote ? 'cancel' : null
		};
	}
	error(404, 'Booking not found');
};

const cancelSchema = z.object({
	kind: z.enum(['room', 'hall']),
	id: z.string().uuid(),
	fee: z.coerce.number().min(0).default(0),
	refundMethod: z.enum(REFUND_METHODS).default('cash'),
	reason: z.string().trim().min(1, 'Enter a reason for the cancellation.').max(500)
});

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

	cancel: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotelId = event.locals.hotel!.id;

		const parsed = cancelSchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' });
		}
		const { kind, id, fee, refundMethod, reason } = parsed.data;

		try {
			const res = await cancelBooking({
				hotelId,
				target: kind === 'room' ? { kind: 'room', bookingId: id } : { kind: 'hall', hallBookingId: id },
				feeCentavos: Math.round(fee * 100),
				refundMethod,
				reason,
				actor: event.locals.user
			});

			// Best-effort guest notification — never blocks the cancellation.
			void sendBookingCancellation(res.orderId, {
				lineId: id,
				feeCentavos: res.feeCentavos,
				refundCentavos: res.refundCentavos,
				refundMethod
			}).catch((e) => console.error('cancel: sendBookingCancellation failed', res.orderId, e));

			const bits = ['Booking cancelled.'];
			if (res.refundCentavos > 0) bits.push(`Refund ₱${(res.refundCentavos / 100).toFixed(2)} recorded.`);
			return { ok: bits.join(' ') };
		} catch (e) {
			if (e instanceof CancellationError) return fail(400, { error: e.message });
			throw e;
		}
	},

	markNoShow: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotelId = event.locals.hotel!.id;
		if (event.params.kind !== 'room') return fail(400, { error: 'Only room bookings can be no-show.' });

		try {
			await markNoShow(hotelId, event.params.id, event.locals.user);
			return { ok: 'Marked as no-show. The room is released.' };
		} catch (e) {
			if (e instanceof CancellationError) return fail(400, { error: e.message });
			throw e;
		}
	},

	replyMessage: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotelId = event.locals.hotel!.id;

		const detail =
			event.params.kind === 'room'
				? await getRoomBookingDetail(hotelId, event.params.id)
				: await getHallBookingDetail(hotelId, event.params.id);
		if (!detail) return fail(404, { error: 'Booking not found.' });

		const raw = Object.fromEntries(await event.request.formData());
		const parsed = z.object({ body: z.string().trim().min(1).max(2000) }).safeParse(raw);
		if (!parsed.success) return fail(400, { error: 'Enter a reply.' });

		try {
			await sendStaffReply({
				hotelId,
				orderId: detail.order.id,
				body: parsed.data.body,
				actor: event.locals.user
			});
			void sendGuestMessageReply(detail.order.id, parsed.data.body).catch((e) =>
				console.error('replyMessage: sendGuestMessageReply failed', detail.order.id, e)
			);
			return { ok: 'Reply sent.' };
		} catch (e) {
			if (e instanceof GuestMessageError) return fail(400, { error: e.message });
			throw e;
		}
	},

	declineRequest: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotelId = event.locals.hotel!.id;

		const raw = Object.fromEntries(await event.request.formData());
		const parsed = z
			.object({ requestId: z.string().uuid(), note: z.string().trim().min(1).max(2000) })
			.safeParse(raw);
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Add a note explaining why.' });
		}

		try {
			const orderId = await declineCancellationRequest({
				hotelId,
				requestId: parsed.data.requestId,
				note: parsed.data.note,
				actor: event.locals.user
			});
			void sendGuestMessageReply(orderId, parsed.data.note).catch((e) =>
				console.error('declineRequest: sendGuestMessageReply failed', orderId, e)
			);
			return { ok: 'Request declined.' };
		} catch (e) {
			if (e instanceof GuestMessageError) return fail(400, { error: e.message });
			throw e;
		}
	},

	manualConfirm: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;

		const detail =
			event.params.kind === 'room'
				? await getRoomBookingDetail(hotelId, event.params.id)
				: await getHallBookingDetail(hotelId, event.params.id);
		if (!detail) return fail(404, { error: 'Booking not found.' });

		const parsed = z
			.object({
				method: z.enum(['cash', 'card', 'gcash', 'maya', 'bank_transfer', 'cheque']),
				referenceNo: z.string().trim().max(120).optional(),
				reason: z.string().trim().min(1, 'Enter a reason.').max(500)
			})
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' });
		}

		try {
			await manuallyConfirmOrder({
				hotelId,
				orderId: detail.order.id,
				method: parsed.data.method,
				referenceNo: parsed.data.referenceNo || null,
				reason: parsed.data.reason,
				actor: event.locals.user
			});
			return { ok: 'Order manually confirmed.' };
		} catch (e) {
			if (e instanceof StatusOverrideError) return fail(400, { error: e.message });
			throw e;
		}
	},

	reinstate: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;
		if (event.params.kind !== 'room' && event.params.kind !== 'hall') {
			return fail(400, { error: 'Booking not found.' });
		}

		const parsed = z
			.object({ reason: z.string().trim().min(1, 'Enter a reason.').max(500) })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Enter a reason.' });
		}

		try {
			const res = await reinstateBooking({
				hotelId,
				target:
					event.params.kind === 'room'
						? { kind: 'room', bookingId: event.params.id }
						: { kind: 'hall', hallBookingId: event.params.id },
				reason: parsed.data.reason,
				actor: event.locals.user
			});
			const bits = ['Booking reinstated.'];
			if (res.refundReversed) bits.push('The earlier refund was reversed.');
			return { ok: bits.join(' ') };
		} catch (e) {
			if (e instanceof StatusOverrideError) return fail(400, { error: e.message });
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
