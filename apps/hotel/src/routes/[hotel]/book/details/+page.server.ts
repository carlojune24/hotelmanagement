import { randomUUID } from 'node:crypto';
import { fail, redirect } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import {
	bookingRooms,
	bookingStatusHistory,
	bookings,
	guests,
	hallBookings,
	hallBookingStatusHistory,
	orders,
	orderStatusHistory
} from '$lib/server/db/schema/index';
import { priceEventHall, priceStay } from '$lib/server/pricing';
import { searchAvailability } from '$lib/server/availability';
import { checkHallAvailability } from '$lib/server/hall-availability';
import { MAX_ROOMS_PER_LINE, scaleRoomPrice } from '$lib/pricing-utils';
import type { Actions } from './$types';

const roomItemSchema = z.object({
	kind: z.literal('room'),
	roomTypeId: z.string().uuid(),
	ratePlanId: z.string().uuid(),
	checkIn: z.string(),
	checkOut: z.string(),
	occupancy: z.coerce.number().int().min(1).max(20),
	roomCount: z.coerce.number().int().min(1).max(MAX_ROOMS_PER_LINE)
});

const hallItemSchema = z.object({
	kind: z.literal('hall'),
	functionHallId: z.string().uuid(),
	eventDate: z.string(),
	startTime: z.string(),
	endTime: z.string(),
	eventType: z.string().max(80),
	guestCount: z.coerce.number().int().min(1)
});

const cartItemSchema = z.discriminatedUnion('kind', [roomItemSchema, hallItemSchema]);
type CartLineInput = z.infer<typeof cartItemSchema>;

const detailsSchema = z.object({
	fullName: z.string().min(2).max(160),
	email: z.string().email(),
	phone: z.string().max(40).optional(),
	specialRequests: z.string().max(1000).optional(),
	cartJson: z.string()
});

/** Distinct, sorted advisory-lock keys for every product touched by the cart — sorted so
 *  two concurrent carts touching the same two products in a different order can't deadlock
 *  each other (generalizes the single two-key lock the old single-item flow used here). */
function lockKeysFor(items: CartLineInput[]): string[] {
	const keys = items.map((item) =>
		item.kind === 'room' ? `room:${item.roomTypeId}` : `hall:${item.functionHallId}:${item.eventDate}`
	);
	return [...new Set(keys)].sort();
}

export const actions: Actions = {
	createOrder: async (event) => {
		const hotelId = event.locals.hotel!.id;
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = detailsSchema.safeParse(raw);
		if (!parsed.success) return fail(400, { error: 'Check your details and try again.' });
		const d = parsed.data;

		let items: CartLineInput[];
		try {
			items = z.array(cartItemSchema).min(1).parse(JSON.parse(d.cartJson));
		} catch {
			return fail(400, {
				error: 'Your invoice looks empty — add a room or the function hall before continuing.'
			});
		}

		const result = await db.transaction(async (tx) => {
			for (const key of lockKeysFor(items)) {
				await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${hotelId}), hashtext(${key}))`);
			}

			let subtotalCentavos = 0;
			let feesCentavos = 0;
			let vatCentavos = 0;
			let totalCentavos = 0;

			const roomLines: Array<{
				item: Extract<CartLineInput, { kind: 'room' }>;
				price: Awaited<ReturnType<typeof priceStay>>;
			}> = [];
			const hallLines: Array<{
				item: Extract<CartLineInput, { kind: 'hall' }>;
				price: Awaited<ReturnType<typeof priceEventHall>>;
			}> = [];

			// Re-verify availability and re-price every line server-side, inside the
			// lock — never trust client-supplied amounts, same posture as the old
			// single-item flow, just looped.
			for (const item of items) {
				if (item.kind === 'room') {
					if (item.checkIn >= item.checkOut) {
						return { ok: false as const, error: 'One of your dates is invalid.' };
					}
					const available = await searchAvailability({
						hotelId,
						checkIn: item.checkIn,
						checkOut: item.checkOut,
						occupancy: item.occupancy,
						roomCount: item.roomCount
					});
					const roomType = available.find((t) => t.id === item.roomTypeId);
					const planAvailable = roomType?.ratePlans.some((p) => p.id === item.ratePlanId);
					if (!roomType || !planAvailable) {
						return {
							ok: false as const,
							error: 'A room in your invoice is no longer available for those dates.'
						};
					}
					const perRoomPrice = await priceStay({
						hotelId,
						ratePlanId: item.ratePlanId,
						checkIn: item.checkIn,
						checkOut: item.checkOut
					});
					// Scaled by roomCount via the same helper the storefront's display uses — the
					// single point where "price × how many rooms" is computed for the real charge.
					const price = scaleRoomPrice(perRoomPrice, item.roomCount);
					const lineFees = price.fees.reduce((sum, f) => sum + f.amountCentavos, 0);
					subtotalCentavos += price.subtotalCentavos;
					feesCentavos += lineFees;
					vatCentavos += price.vatCentavos;
					totalCentavos += price.totalCentavos;
					roomLines.push({ item, price });
				} else {
					const isAvailable = await checkHallAvailability({
						hotelId,
						functionHallId: item.functionHallId,
						eventDate: item.eventDate,
						startTime: item.startTime,
						endTime: item.endTime
					});
					if (!isAvailable) {
						return {
							ok: false as const,
							error: 'The function hall slot in your invoice is no longer available.'
						};
					}
					const price = await priceEventHall({
						hotelId,
						functionHallId: item.functionHallId,
						startTime: item.startTime,
						endTime: item.endTime
					});
					const lineFees = price.fees.reduce((sum, f) => sum + f.amountCentavos, 0);
					subtotalCentavos += price.subtotalCentavos;
					feesCentavos += lineFees;
					vatCentavos += price.vatCentavos;
					totalCentavos += price.totalCentavos;
					hallLines.push({ item, price });
				}
			}

			const accessToken = randomUUID();
			const [guest] = await tx
				.insert(guests)
				.values({
					hotelId,
					fullName: d.fullName.trim(),
					email: d.email.trim().toLowerCase(),
					phone: d.phone?.trim() || null,
					specialRequests: d.specialRequests?.trim() || null
				})
				.returning({ id: guests.id });

			const [order] = await tx
				.insert(orders)
				.values({
					hotelId,
					guestId: guest!.id,
					subtotalCentavos,
					feesCentavos,
					vatCentavos,
					totalCentavos,
					accessToken
				})
				.returning({ id: orders.id });

			await tx.insert(orderStatusHistory).values({
				orderId: order!.id,
				fromStatus: null,
				toStatus: 'pending_payment',
				note: 'Order created'
			});

			for (const { item, price } of roomLines) {
				const lineFees = price.fees.reduce((sum, f) => sum + f.amountCentavos, 0);
				const [booking] = await tx
					.insert(bookings)
					.values({
						hotelId,
						orderId: order!.id,
						checkIn: item.checkIn,
						checkOut: item.checkOut,
						occupancy: item.occupancy,
						status: 'pending_payment',
						subtotalCentavos: price.subtotalCentavos,
						feesCentavos: lineFees,
						vatCentavos: price.vatCentavos,
						totalCentavos: price.totalCentavos
					})
					.returning({ id: bookings.id });

				await tx.insert(bookingRooms).values({
					bookingId: booking!.id,
					roomTypeId: item.roomTypeId,
					ratePlanId: item.ratePlanId,
					quantity: item.roomCount
				});
				await tx.insert(bookingStatusHistory).values({
					bookingId: booking!.id,
					fromStatus: null,
					toStatus: 'pending_payment',
					note: 'Booking created'
				});
			}

			for (const { item, price } of hallLines) {
				const lineFees = price.fees.reduce((sum, f) => sum + f.amountCentavos, 0);
				const [hallBooking] = await tx
					.insert(hallBookings)
					.values({
						orderId: order!.id,
						functionHallId: item.functionHallId,
						eventDate: item.eventDate,
						startTime: item.startTime,
						endTime: item.endTime,
						eventType: item.eventType,
						guestCount: item.guestCount,
						status: 'pending_payment',
						subtotalCentavos: price.subtotalCentavos,
						feesCentavos: lineFees,
						vatCentavos: price.vatCentavos,
						totalCentavos: price.totalCentavos
					})
					.returning({ id: hallBookings.id });

				await tx.insert(hallBookingStatusHistory).values({
					hallBookingId: hallBooking!.id,
					fromStatus: null,
					toStatus: 'pending_payment',
					note: 'Hall booking created'
				});
			}

			return { ok: true as const, orderId: order!.id, accessToken };
		});

		if (!result.ok) {
			return fail(400, { error: result.error });
		}

		redirect(303, `review/${result.orderId}?t=${result.accessToken}`);
	}
};
