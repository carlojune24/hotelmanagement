import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { roleCan } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import { getHallBookingDetail, getRoomBookingDetail } from '$lib/server/reservations';
import {
	CheckInError,
	checkInBooking,
	listEligibleRooms,
	todayInTimezone
} from '$lib/server/front-desk';
import { sendBookingConfirmation } from '$lib/server/email/send-booking-confirmation';
import { sendPaymentLink } from '$lib/server/email/send-payment-link';
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
import {
	ModifyStayError,
	listRoomTypeOptionsForModify,
	modifyBookingStay
} from '$lib/server/booking-modify';
import { saveUpload } from '$lib/server/uploads';
import {
	SecurityDepositError,
	collectSecurityDeposit,
	getSecurityDepositForBooking,
	getSecurityDepositPolicy
} from '$lib/server/security-deposits';
import {
	ScPwdDiscountError,
	applyScPwdDiscount,
	getActiveScPwdClaim
} from '$lib/server/sc-pwd-discount';
import type { PaymentMethod } from '$lib/server/finance/payments';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCap(locals.user, locals.role, 'booking:read');
	const hotel = locals.hotel!;
	const hotelId = hotel.id;
	const actionHint = url.searchParams.get('action'); // 'cancel' | 'no-show', from a deep link
	// Reservation status override (manual-confirm / reinstate) is hotel_admin-only —
	// same double-gate `management/finance`'s day-close reopen uses, not plain `booking:write`
	// (which `front_desk` already has).
	const canAdmin =
		locals.user?.isPlatformAdmin ||
		(locals.role ? roleCan(locals.role.capabilities, 'hotel:admin') : false);

	if (params.kind === 'room') {
		const detail = await getRoomBookingDetail(hotelId, params.id);
		if (!detail) error(404, 'Booking not found');

		// Excludes this same booking's own pre-assigned room(s) from the "occupied"
		// set (front-desk grid pick mode) — otherwise a room this booking already
		// holds would make itself ineligible in its own check-in picker.
		const eligibleRooms =
			detail.booking.status === 'confirmed'
				? await listEligibleRooms(
						hotelId,
						detail.bookingRoom.roomTypeId,
						detail.booking.checkIn,
						detail.booking.checkOut,
						params.id
					)
				: [];

		const cancellable = ['confirmed', 'pending_payment'].includes(detail.booking.status);
		const cancelQuote = cancellable
			? await getCancellationQuote(hotelId, { kind: 'room', bookingId: params.id })
			: null;
		const canMarkNoShow =
			detail.booking.status === 'confirmed' &&
			detail.booking.checkIn < todayInTimezone(hotel.timezone);
		const canModifyStay =
			(detail.booking.status === 'confirmed' || detail.booking.status === 'checked_in') &&
			detail.order.status === 'confirmed';
		// Room type/rate plan/occupancy changes are confirmed-only (see booking-modify.ts) —
		// no need to fetch the picker options otherwise.
		const modifyRoomTypeOptions =
			canModifyStay && detail.booking.status === 'confirmed'
				? await listRoomTypeOptionsForModify(hotelId)
				: [];

		const [thread, openRequest, securityDepositPolicy, securityDeposit, scPwdClaim] =
			await Promise.all([
				listThread(detail.order.id),
				getOpenRequest({ kind: 'room', bookingId: params.id }),
				detail.ratePlan.securityDepositPolicyId
					? getSecurityDepositPolicy(hotelId, detail.ratePlan.securityDepositPolicyId)
					: null,
				getSecurityDepositForBooking(hotelId, params.id),
				getActiveScPwdClaim(hotelId, params.id)
			]);
		await markThreadReadByStaff(detail.order.id);

		return {
			kind: 'room' as const,
			detail,
			eligibleRooms,
			cancelQuote,
			canMarkNoShow,
			canModifyStay,
			modifyRoomTypeOptions,
			canAdmin,
			thread,
			openRequest,
			securityDepositPolicy,
			securityDeposit,
			scPwdClaim,
			autoOpen:
				actionHint === 'cancel' && cancelQuote
					? 'cancel'
					: actionHint === 'no-show' && canMarkNoShow
						? 'no-show'
						: null
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
		// May be empty — a booking whose room(s) were already pre-assigned on the
		// front-desk grid (pick mode, at booking time) submits no `roomId` fields at
		// all; `checkInBooking` detects and reuses those existing rows itself. Still
		// required for a booking with no pre-assignment, which `checkInBooking`
		// enforces server-side.
		const parsed = z.array(z.string().uuid()).safeParse(raw.getAll('roomId'));
		if (!parsed.success) return fail(400, { error: 'Select a room for check-in.' });

		// Optional — a live camera capture from the check-in form, never a file picker.
		// Never blocks check-in: a bad/oversized photo is dropped with a toast, not a
		// failed check-in.
		let guestIdPhotoUrl: string | null = null;
		const idPhoto = raw.get('guestIdPhoto');
		if (idPhoto instanceof File && idPhoto.size > 0) {
			try {
				guestIdPhotoUrl = await saveUpload(hotelId, idPhoto);
			} catch (e) {
				console.error('checkIn: could not save guest ID photo', event.params.id, e);
			}
		}

		try {
			const result = await checkInBooking(
				hotelId,
				event.params.id,
				parsed.data,
				event.locals.user,
				guestIdPhotoUrl
			);

			// Optional — a refundable security deposit hold, amount pre-filled from the
			// rate plan's policy but staff-editable. Never blocks check-in: it already
			// committed above, so a bad cash account / no open shift here is logged and
			// surfaced as a toast on the next page instead of failing the whole action.
			const depositAmountPhp = raw.get('depositAmount');
			const depositMethod = raw.get('depositMethod');
			if (depositAmountPhp && depositMethod) {
				try {
					await collectSecurityDeposit({
						hotelId,
						bookingId: event.params.id,
						securityDepositPolicyId: (raw.get('securityDepositPolicyId') as string) || null,
						amountCentavos: Math.round(Number(depositAmountPhp) * 100),
						method: depositMethod as PaymentMethod,
						tenderedCentavos: raw.get('depositTendered')
							? Math.round(Number(raw.get('depositTendered')) * 100)
							: null,
						referenceNo: (raw.get('depositReferenceNo') as string) || null,
						actor: event.locals.user
					});
				} catch (e) {
					if (e instanceof SecurityDepositError) {
						console.error('checkIn: could not collect security deposit', event.params.id, e.message);
					} else {
						console.error('checkIn: could not collect security deposit', event.params.id, e);
					}
				}
			}

			// Optional — BIR Senior Citizen / PWD discount, flagged from the same form. Never
			// blocks check-in: it already committed above, so a bad ID field here is logged
			// and surfaced as a toast on the next page instead of failing the whole action.
			const scPwdFlagged = raw.get('scPwdFlagged');
			if (scPwdFlagged === 'on') {
				try {
					await applyScPwdDiscount({
						hotelId,
						bookingId: event.params.id,
						claimantType: raw.get('scPwdClaimantType') === 'pwd' ? 'pwd' : 'senior_citizen',
						claimantName: (raw.get('scPwdClaimantName') as string) || '',
						idNumber: (raw.get('scPwdIdNumber') as string) || '',
						actor: event.locals.user
					});
				} catch (e) {
					if (e instanceof ScPwdDiscountError) {
						console.error('checkIn: could not apply SC/PWD discount', event.params.id, e.message);
					} else {
						console.error('checkIn: could not apply SC/PWD discount', event.params.id, e);
					}
				}
			}

			// A multi-room-type walk-in (or online order) settled together still becomes
			// one `bookings` row per room line under one order (see `reservations.ts`'s
			// `siblingLines`) — if this booking has a sibling room reservation on that
			// same order still waiting on its own check-in, guide staff straight there
			// instead of dropping them on front-desk with no clue the other room needs
			// the same step. Only once every sibling is checked in (or there was only
			// ever one room) does check-in land back on the grid, per the original
			// behavior below.
			const detail = await getRoomBookingDetail(hotelId, event.params.id);
			const nextSibling = detail?.siblings.find(
				(s) => s.kind === 'room' && s.status === 'confirmed'
			);
			if (nextSibling) {
				redirect(
					303,
					`/${event.params.hotel}/management/reservations/room/${nextSibling.id}?from=front-desk&roomId=${result.roomIds[0]}`
				);
			}

			// Check-in is a front-desk operation — land back on the room grid with the
			// just-assigned room selected, instead of leaving staff on this booking page.
			// Uses the function's own result (not the submitted `roomId` fields) since a
			// pre-assigned booking submits none — the room came from its existing
			// `room_assignments` row instead.
			redirect(303, `/${event.params.hotel}/management/front-desk?roomId=${result.roomIds[0]}`);
		} catch (e) {
			if (e instanceof CheckInError) return fail(400, { error: e.message });
			throw e;
		}
	},

	cancel: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotelId = event.locals.hotel!.id;

		const raw = await event.request.formData();
		const parsed = cancelSchema.safeParse(Object.fromEntries(raw));
		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? 'Check the form and try again.'
			});
		}
		const { kind, id, fee, refundMethod, reason } = parsed.data;

		// Optional — proof of a manual payout (bank transfer confirmation, e-wallet
		// screenshot). Never blocks the cancellation: a bad/oversized file is dropped
		// silently rather than failing the whole action, same as the check-in ID photo.
		let attachmentUrl: string | null = null;
		if (refundMethod !== 'paymongo') {
			const attachment = raw.get('refundAttachment');
			if (attachment instanceof File && attachment.size > 0) {
				try {
					attachmentUrl = await saveUpload(hotelId, attachment);
				} catch (e) {
					console.error('cancel: could not save refund attachment', id, e);
				}
			}
		}

		try {
			const res = await cancelBooking({
				hotelId,
				target:
					kind === 'room' ? { kind: 'room', bookingId: id } : { kind: 'hall', hallBookingId: id },
				feeCentavos: Math.round(fee * 100),
				refundMethod,
				reason,
				actor: event.locals.user,
				attachmentUrl
			});

			// Best-effort guest notification — never blocks the cancellation.
			void sendBookingCancellation(res.orderId, {
				lineId: id,
				feeCentavos: res.feeCentavos,
				refundCentavos: res.refundCentavos,
				refundMethod
			}).catch((e) => console.error('cancel: sendBookingCancellation failed', res.orderId, e));

			const bits = ['Booking cancelled.'];
			if (res.refundCentavos > 0)
				bits.push(`Refund ₱${(res.refundCentavos / 100).toFixed(2)} recorded.`);
			return { ok: bits.join(' ') };
		} catch (e) {
			if (e instanceof CancellationError) return fail(400, { error: e.message });
			throw e;
		}
	},

	markNoShow: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotelId = event.locals.hotel!.id;
		if (event.params.kind !== 'room')
			return fail(400, { error: 'Only room bookings can be no-show.' });

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
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? 'Check the form and try again.'
			});
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

	modifyStay: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotelId = event.locals.hotel!.id;
		if (event.params.kind !== 'room')
			return fail(400, { error: 'Only room bookings can be modified this way.' });

		const parsed = z
			.object({
				checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid check-in date.'),
				checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid check-out date.'),
				roomTypeId: z.string().uuid().optional().or(z.literal('')),
				ratePlanId: z.string().uuid().optional().or(z.literal('')),
				occupancy: z.coerce.number().int().min(1).max(50).optional(),
				extraBeds: z.coerce.number().int().min(0).max(50).optional(),
				reason: z.string().trim().min(1, 'Enter a reason for this change.').max(500)
			})
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? 'Check the form and try again.'
			});
		}

		try {
			const res = await modifyBookingStay({
				hotelId,
				bookingId: event.params.id,
				newCheckIn: parsed.data.checkIn,
				newCheckOut: parsed.data.checkOut,
				newRoomTypeId: parsed.data.roomTypeId || undefined,
				newRatePlanId: parsed.data.ratePlanId || undefined,
				newOccupancy: parsed.data.occupancy,
				newExtraBeds: parsed.data.extraBeds,
				reason: parsed.data.reason,
				actor: event.locals.user
			});
			const bits = ['Booking updated.'];
			if (res.deltaCentavos > 0)
				bits.push(`Folio charged ₱${(res.deltaCentavos / 100).toFixed(2)}.`);
			if (res.deltaCentavos < 0)
				bits.push(`Folio credited ₱${(-res.deltaCentavos / 100).toFixed(2)}.`);
			return { ok: bits.join(' ') };
		} catch (e) {
			if (e instanceof ModifyStayError) return fail(400, { error: e.message });
			throw e;
		}
	},

	/** Emails the guest a link back to the payment step of an unpaid online booking. */
	sendPaymentLink: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotelId = event.locals.hotel!.id;
		const detail =
			event.params.kind === 'room'
				? await getRoomBookingDetail(hotelId, event.params.id)
				: await getHallBookingDetail(hotelId, event.params.id);
		if (!detail) return fail(404, { error: 'Booking not found.' });
		if (detail.order.status !== 'pending_payment')
			return fail(400, { error: 'Only a booking waiting for payment can be sent a payment link.' });

		const res = await sendPaymentLink(detail.order.id);
		if (!res.ok) return fail(502, { error: `Could not send: ${res.error ?? 'unknown error'}` });
		return { ok: `Payment link emailed to ${detail.guest.email}.` };
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
