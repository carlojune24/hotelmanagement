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
	orderStatusHistory,
	promoRedemptions
} from '$lib/server/db/schema/index';
import { priceEventHall, priceStay } from '$lib/server/pricing';
import { computeDownpayment } from '$lib/downpayment';
import { splitInteger, splitProportional, splitRoomLine } from '$lib/room-split';
import { downpaymentBpsByRatePlan } from '$lib/server/downpayment-lookup';
import { searchAvailability } from '$lib/server/availability';
import { isOnlinePaymentEnabled } from '$lib/server/paymongo/client';
import { checkHallAvailability } from '$lib/server/hall-availability';
import { MAX_ROOMS_PER_LINE, addFlatFeeCentavos, scaleRoomPrice } from '$lib/pricing-utils';
import {
	MAX_PROMO_CODE_LENGTH,
	PromoLimitError,
	assertPromoWithinLimits,
	computePromoDiscountCentavos,
	findRedeemablePromoCode
} from '$lib/server/promo-codes';
import { promoGuessByIp, tooManyMessage } from '$lib/server/auth/rate-limit';
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
	cartJson: z.string(),
	/** A whole-order discount code, not tied to any one cart line — re-verified and priced
	 *  here, never trusted as proof by itself. */
	promoCode: z.string().max(MAX_PROMO_CODE_LENGTH).optional()
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
		// No PayMongo account connected (Settings → Payments & email) = no online payment, so
		// don't create an order that would hold rooms with no way to pay for them.
		if (!(await isOnlinePaymentEnabled(hotelId))) {
			return fail(400, {
				error: "Online booking isn't available for this hotel yet — please contact the hotel directly to reserve."
			});
		}
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = detailsSchema.safeParse(raw);
		if (!parsed.success) return fail(400, { error: 'Check your details and try again.' });
		const d = parsed.data;

		// RATES-002: slow down anyone guessing promo codes. Only failed tries are counted (below).
		let promoAttemptKey = `${hotelId}|unknown`;
		try {
			promoAttemptKey = `${hotelId}|${event.getClientAddress()}`;
		} catch {
			// No client address available (some adapters/tests) — share one bucket per hotel.
		}
		if (d.promoCode?.trim()) {
			const wait = promoGuessByIp.retryAfter(promoAttemptKey);
			if (wait > 0) return fail(429, { error: tooManyMessage(wait) });
		}

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

			// Guard against two lines requesting the same room type for the same dates
			// (e.g. one rate plan per room, from a guest comparing rates) summing to more
			// rooms than actually exist. Each line's own `searchAvailability` call below only
			// sees rooms already committed in the DB, not sibling lines still being validated
			// in this same loop, so two lines could otherwise each "pass" individually even
			// though combined they overbook. Grouped by (roomTypeId, checkIn, checkOut) since
			// that's the real availability key — different rate plans for the same type/dates
			// draw from one shared pool of physical rooms. `occupancy: 1` is deliberately
			// lenient so this check never fails a room type for an occupancy-fit reason —
			// that's still re-verified per-item, with its real occupancy, below.
			const roomGroupCounts = new Map<string, number>();
			for (const item of items) {
				if (item.kind !== 'room') continue;
				const key = `${item.roomTypeId}|${item.checkIn}|${item.checkOut}`;
				roomGroupCounts.set(key, (roomGroupCounts.get(key) ?? 0) + item.roomCount);
			}
			for (const [key, combinedRoomCount] of roomGroupCounts) {
				const [roomTypeId, checkIn, checkOut] = key.split('|') as [string, string, string];
				if (checkIn >= checkOut) {
					return { ok: false as const, error: 'One of your dates is invalid.' };
				}
				const combinedAvailable = await searchAvailability({
					hotelId,
					checkIn,
					checkOut,
					occupancy: 1,
					roomCount: combinedRoomCount
				});
				if (!combinedAvailable.some((t) => t.id === roomTypeId)) {
					return {
						ok: false as const,
						error: 'A room in your invoice is no longer available for those dates.'
					};
				}
			}

			let subtotalCentavos = 0;
			let feesCentavos = 0;
			let vatCentavos = 0;
			let totalCentavos = 0;

			const roomLines: Array<{
				item: Extract<CartLineInput, { kind: 'room' }>;
				price: Awaited<ReturnType<typeof priceStay>>;
				extraBeds: number;
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
					const plan = roomType?.ratePlans.find((p) => p.id === item.ratePlanId);
					if (!roomType || !plan) {
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
					let price = scaleRoomPrice(perRoomPrice, item.roomCount);
					// Extra beds needed is re-derived from the room type's own capacity/policy
					// (`searchAvailability` already ran the occupancy solver) rather than trusted
					// from the guest's cart — same "never trust the client" posture as the rest of
					// this re-verification loop.
					const extraBeds = roomType.extraBedsNeeded;
					if (extraBeds > 0 && plan.extraBedFeeCentavos) {
						price = addFlatFeeCentavos(
							price,
							`Extra bed × ${extraBeds}`,
							extraBeds * plan.extraBedFeeCentavos,
							event.locals.hotel!.vatRateBps
						);
					}
					const lineFees = price.fees.reduce((sum, f) => sum + f.amountCentavos, 0);
					subtotalCentavos += price.subtotalCentavos;
					feesCentavos += lineFees;
					vatCentavos += price.vatCentavos;
					totalCentavos += price.totalCentavos;
					roomLines.push({ item, price, extraBeds });
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

			// A whole-order discount, applied here — after every line is priced, but before
			// totals are frozen and bookings are inserted — rather than as a later folio
			// adjustment: `ensureFolio` seeds a folio's first charge straight from
			// `bookings.totalCentavos`, so discounting after that point would double-count
			// against a booking whose total is *also* already reduced. Rooms only (halls are
			// never discounted), matching the "room's folio" framing in the promo_codes schema.
			let discountCentavos = 0;
			let lineDiscounts: number[] = roomLines.map(() => 0);
			let redeemedPromoCodeId: string | null = null;
			let redeemedPromoCodeText: string | null = null;
			const rawPromoCode = d.promoCode?.trim();
			if (rawPromoCode) {
				const promo = await findRedeemablePromoCode(hotelId, rawPromoCode, new Date());
				if (!promo) {
					promoGuessByIp.recordFailure(promoAttemptKey);
					return { ok: false as const, error: "That promo code isn't valid for this stay." };
				}
				const eligibleCentavos = roomLines.reduce((sum, l) => sum + l.price.totalCentavos, 0);
				discountCentavos = computePromoDiscountCentavos(promo, eligibleCentavos);
				// A code that would cover the whole order leaves nothing to charge, and the payment
				// provider can't take a zero-amount payment — refuse it here, before anything is saved.
				if (discountCentavos > 0 && totalCentavos - discountCentavos <= 0) {
					return { ok: false as const, error: "That promo code can't be applied to this stay." };
				}
				// Enforce the code's usage limits atomically, inside this transaction.
				try {
					await assertPromoWithinLimits(tx, promo.id, d.email);
				} catch (e) {
					if (e instanceof PromoLimitError) {
						promoGuessByIp.recordFailure(promoAttemptKey);
						return { ok: false as const, error: "That promo code isn't valid for this stay." };
					}
					throw e;
				}
				if (discountCentavos > 0) {
					lineDiscounts = splitProportional(
						discountCentavos,
						roomLines.map((l) => l.price.totalCentavos)
					);
				}
				redeemedPromoCodeId = promo.id;
				redeemedPromoCodeText = promo.code;
			}

			// What the guest pays online to confirm: each room line's policy downpayment (halls
			// have no policy, so they pay in full), snapshotted on the order now so a later
			// policy edit can't change what an already-created order owes. Uses each line's
			// already-discounted total so the downpayment percentage lands on the real charge.
			const bpsByPlan = await downpaymentBpsByRatePlan(
				hotelId,
				roomLines.map((l) => l.item.ratePlanId)
			);
			const { dueNowCentavos } = computeDownpayment([
				...roomLines.map((l, i) => ({
					totalCentavos: l.price.totalCentavos - (lineDiscounts[i] ?? 0),
					downpaymentBps: bpsByPlan.get(l.item.ratePlanId) ?? null
				})),
				...hallLines.map((l) => ({ totalCentavos: l.price.totalCentavos, downpaymentBps: null }))
			]);

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

			// subtotal/fees/vat stay at their true, undiscounted values — a promo discount is
			// shown as its own line (Review page) rather than folded silently into a subtotal
			// that would then no longer reconcile with the stated VAT.
			const discountedTotalCentavos = totalCentavos - discountCentavos;
			const [order] = await tx
				.insert(orders)
				.values({
					hotelId,
					guestId: guest!.id,
					subtotalCentavos,
					feesCentavos,
					vatCentavos,
					totalCentavos: discountedTotalCentavos,
					discountCentavos: discountCentavos > 0 ? discountCentavos : null,
					// Null (not the total) when paying in full, so full-pay orders stay
					// indistinguishable from every order created before downpayments existed.
					amountDueNowCentavos: dueNowCentavos < discountedTotalCentavos ? dueNowCentavos : null,
					accessToken
				})
				.returning({ id: orders.id });

			await tx.insert(orderStatusHistory).values({
				orderId: order!.id,
				fromStatus: null,
				toStatus: 'pending_payment',
				note: 'Order created'
			});

			// One booking PER ROOM, not one per cart line: "2 × Deluxe" becomes two bookings so each room
			// has its own folio, security deposit and charges. The line's price, guests and extra beds
			// are split exactly across them.
			for (const [lineIndex, { item, price, extraBeds }] of roomLines.entries()) {
				const lineFees = price.fees.reduce((sum, f) => sum + f.amountCentavos, 0);
				const shares = splitRoomLine(
					{
						subtotalCentavos: price.subtotalCentavos,
						feesCentavos: lineFees,
						vatCentavos: price.vatCentavos,
						totalCentavos: price.totalCentavos
					},
					item.occupancy,
					extraBeds,
					item.roomCount
				);
				// Each room's own slice of this line's discount, if any — whole-centavo-safe
				// split, same scheme `splitRoomLine` already uses for everything else here.
				const bookingDiscounts = splitInteger(lineDiscounts[lineIndex] ?? 0, item.roomCount);
				for (const [shareIndex, share] of shares.entries()) {
					const bookingDiscountCentavos = bookingDiscounts[shareIndex] ?? 0;
					const [booking] = await tx
						.insert(bookings)
						.values({
							hotelId,
							orderId: order!.id,
							checkIn: item.checkIn,
							checkOut: item.checkOut,
							occupancy: share.occupancy,
							status: 'pending_payment',
							subtotalCentavos: share.subtotalCentavos - bookingDiscountCentavos,
							feesCentavos: share.feesCentavos,
							vatCentavos: share.vatCentavos,
							totalCentavos: share.totalCentavos - bookingDiscountCentavos,
							discountCentavos: bookingDiscountCentavos > 0 ? bookingDiscountCentavos : null
						})
						.returning({ id: bookings.id });

					await tx.insert(bookingRooms).values({
						bookingId: booking!.id,
						roomTypeId: item.roomTypeId,
						ratePlanId: item.ratePlanId,
						quantity: 1,
						extraBeds: share.extraBeds
					});
					await tx.insert(bookingStatusHistory).values({
						bookingId: booking!.id,
						fromStatus: null,
						toStatus: 'pending_payment',
						note:
							share.extraBeds > 0
								? `Booking created — ${share.extraBeds} extra bed(s) added`
								: 'Booking created'
					});
					if (bookingDiscountCentavos > 0) {
						await tx.insert(promoRedemptions).values({
							hotelId,
							promoCodeId: redeemedPromoCodeId!,
							bookingId: booking!.id,
							code: redeemedPromoCodeText!,
							discountCentavos: bookingDiscountCentavos,
							folioChargeId: null
						});
					}
				}
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
