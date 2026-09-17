import { error, fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import {
	bookingRooms,
	bookings,
	functionHalls,
	guests,
	hallBookings,
	orders,
	ratePlans,
	roomTypes
} from '$lib/server/db/schema/index';
import {
	GuestMessageError,
	getOpenRequest,
	listThread,
	submitCancellationRequest,
	submitGuestMessage
} from '$lib/server/guest-messages';
import type { Actions, PageServerLoad } from './$types';

const CANCELLABLE = ['confirmed', 'pending_payment'];

/** `enhance`'s `?/action` form-action URL is resolved against the DOM and drops
 *  the page's own query string (verified against the WHATWG URL spec, not
 *  assumed — the same fix applied to `leave-review`), so every action form here
 *  carries the token as a hidden `t` field instead of relying on `event.url`. */
function tokenFrom(formData: FormData, url: URL): string | null {
	const field = formData.get('t');
	return typeof field === 'string' && field ? field : url.searchParams.get('t');
}

async function loadGuardedOrder(hotelId: string, orderId: string, token: string | null) {
	if (!token) error(404, 'Not found');
	const [order] = await db
		.select()
		.from(orders)
		.where(and(eq(orders.id, orderId), eq(orders.hotelId, hotelId)));
	if (!order || order.accessToken !== token) error(404, 'Not found');
	return order;
}

export const load: PageServerLoad = async ({ locals, params, url, depends }) => {
	depends('app:guest-messages');
	const hotelId = locals.hotel!.id;
	const order = await loadGuardedOrder(hotelId, params.orderId, url.searchParams.get('t'));

	const [guest] = await db.select().from(guests).where(eq(guests.id, order.guestId));

	const roomRows = await db
		.select({
			id: bookings.id,
			status: bookings.status,
			checkIn: bookings.checkIn,
			checkOut: bookings.checkOut,
			quantity: bookingRooms.quantity,
			roomTypeName: roomTypes.name,
			ratePlanName: ratePlans.name,
			totalCentavos: bookings.totalCentavos
		})
		.from(bookings)
		.innerJoin(bookingRooms, eq(bookingRooms.bookingId, bookings.id))
		.innerJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId))
		.innerJoin(ratePlans, eq(ratePlans.id, bookingRooms.ratePlanId))
		.where(eq(bookings.orderId, order.id));

	const hallRows = await db
		.select({
			id: hallBookings.id,
			status: hallBookings.status,
			eventDate: hallBookings.eventDate,
			startTime: hallBookings.startTime,
			endTime: hallBookings.endTime,
			eventType: hallBookings.eventType,
			hallName: functionHalls.name,
			totalCentavos: hallBookings.totalCentavos
		})
		.from(hallBookings)
		.innerJoin(functionHalls, eq(functionHalls.id, hallBookings.functionHallId))
		.where(eq(hallBookings.orderId, order.id));

	const roomLines = await Promise.all(
		roomRows.map(async (r) => ({
			...r,
			cancellable: CANCELLABLE.includes(r.status),
			openRequest: CANCELLABLE.includes(r.status)
				? await getOpenRequest({ kind: 'room', bookingId: r.id })
				: null
		}))
	);
	const hallLines = await Promise.all(
		hallRows.map(async (h) => ({
			...h,
			cancellable: CANCELLABLE.includes(h.status),
			openRequest: CANCELLABLE.includes(h.status)
				? await getOpenRequest({ kind: 'hall', hallBookingId: h.id })
				: null
		}))
	);

	const thread = await listThread(order.id);

	return {
		order: {
			id: order.id,
			accessToken: order.accessToken,
			status: order.status,
			confirmationCode: order.id.slice(0, 8).toUpperCase()
		},
		guestName: guest!.fullName,
		roomLines,
		hallLines,
		thread
	};
};

const requestSchema = z.object({
	kind: z.enum(['room', 'hall']),
	id: z.string().uuid(),
	reason: z.string().trim().min(1, 'Enter a reason for the cancellation.').max(2000)
});

const messageSchema = z.object({
	body: z.string().trim().min(1, 'Enter a message.').max(2000)
});

export const actions: Actions = {
	requestCancellation: async (event) => {
		const hotelId = event.locals.hotel!.id;
		const formData = await event.request.formData();
		// Guard only — the request itself is keyed off the line id, not the order.
		await loadGuardedOrder(hotelId, event.params.orderId, tokenFrom(formData, event.url));

		const parsed = requestSchema.safeParse(Object.fromEntries(formData));
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' });
		}
		const { kind, id, reason } = parsed.data;

		try {
			await submitCancellationRequest({
				hotelId,
				target: kind === 'room' ? { kind: 'room', bookingId: id } : { kind: 'hall', hallBookingId: id },
				reason
			});
			return { ok: 'Request sent — the hotel will follow up.' };
		} catch (e) {
			if (e instanceof GuestMessageError) return fail(400, { error: e.message });
			throw e;
		}
	},

	sendMessage: async (event) => {
		const hotelId = event.locals.hotel!.id;
		const formData = await event.request.formData();
		const order = await loadGuardedOrder(hotelId, event.params.orderId, tokenFrom(formData, event.url));

		const parsed = messageSchema.safeParse(Object.fromEntries(formData));
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Enter a message.' });
		}

		try {
			await submitGuestMessage({ hotelId, orderId: order.id, body: parsed.data.body });
			return { ok: 'Message sent.' };
		} catch (e) {
			if (e instanceof GuestMessageError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
