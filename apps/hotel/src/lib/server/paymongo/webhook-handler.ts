import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import {
	bookings,
	bookingStatusHistory,
	financeSettings,
	hallBookings,
	hallBookingStatusHistory,
	guests,
	hotels,
	orders,
	orderStatusHistory,
	payments
} from '$lib/server/db/schema/index';
import { recordCashMovement } from '$lib/server/finance/cash';
import { getBirSettings, issueOfficialReceipt } from '$lib/server/finance/documents';
import { businessDateFor } from '$lib/server/finance/shared';
import { sendBookingConfirmation } from '$lib/server/email/send-booking-confirmation';
import { writeAudit } from '$lib/server/audit';
import { confirmDiningPayment, diningEventHotelId, recordDiningPaymentFailure } from '$lib/server/dining-online';
import { confirmRoomPayment } from './confirm-room-payment';
import { verifyOpenAttemptsForHotel } from './verify';

/**
 * PayMongo webhook event handling, shared by the per-hotel endpoint
 * (`/api/webhooks/paymongo/[hotel]`, signed with that hotel's own webhook secret) and the
 * legacy un-scoped endpoint. The caller has ALREADY verified the signature.
 *
 * `scope.hotelId` (per-hotel endpoint): the event must belong to that hotel — its order's
 * `hotel_id`, or for a refund event the refunded payment's order. An event for another
 * hotel's booking is ignored, so one hotel's PayMongo account can never move another
 * hotel's money. `null` = legacy endpoint, no scoping.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handlePaymongoEvent(
	event: any,
	scope: { hotelId: string | null }
): Promise<void> {
	if (scope.hotelId) {
		const owner = await eventHotelId(event);
		if (owner && owner !== scope.hotelId) {
			console.error('paymongo webhook: event belongs to another hotel — ignored', event?.data?.id, {
				endpointHotel: scope.hotelId,
				eventHotel: owner
			});
			return;
		}
	}

	const type = event?.data?.attributes?.type as string | undefined;
	const eventId = event?.data?.id as string | undefined;

	switch (type) {
		case 'checkout_session.payment.paid': {
			// The webhook's resource is the Checkout Session itself, carrying our
			// `metadata.orderId` and its associated Payment(s) — not a bare payment object.
			const checkoutSession = event?.data?.attributes?.data;

			// A restaurant order's checkout carries `metadata.kind = 'dining'`: it has its own
			// payment record and finance posting, and never touches room orders or `payments`.
			if (checkoutSession?.attributes?.metadata?.kind === 'dining') {
				const diningOrderId = checkoutSession.attributes.metadata.diningOrderId as string | undefined;
				const diningPayment = checkoutSession.attributes.payments?.[0];
				const diningAmount = diningPayment?.attributes?.amount as number | undefined;
				if (!diningOrderId || !eventId || diningAmount == null) {
					console.error('paymongo webhook: missing diningOrderId/eventId/amount on payload', eventId);
					break;
				}
				await confirmDiningPayment({
					eventId,
					orderId: diningOrderId,
					sessionId: (checkoutSession.id as string | undefined) ?? null,
					paymentId: (diningPayment?.id as string | undefined) ?? null,
					amountCentavos: diningAmount,
					payload: event
				});
				break;
			}

			const orderId = checkoutSession?.attributes?.metadata?.orderId as string | undefined;
			const payment = checkoutSession?.attributes?.payments?.[0];
			const paymentId = payment?.id as string | undefined;
			const amountCentavos = payment?.attributes?.amount as number | undefined;
			const currency = (payment?.attributes?.currency as string | undefined) ?? 'PHP';

			if (!orderId || !eventId || amountCentavos == null) {
				console.error('paymongo webhook: missing orderId/eventId/amount on payload', event);
				break;
			}

			await confirmRoomPayment({
				eventId,
				orderId,
				sessionId: (checkoutSession?.id as string | undefined) ?? null,
				paymentId,
				amountCentavos,
				currency,
				payload: event
			});
			break;
		}
		case 'payment.paid': {
			// A bare payment carries no booking metadata, so it cannot confirm anything by itself. It does tell us a
			// payment just happened: ask PayMongo about this hotel's open checkouts now instead of waiting for the
			// worker's next minute. (`checkout_session.payment.paid` is the event that confirms directly.)
			if (scope.hotelId) await verifyOpenAttemptsForHotel(scope.hotelId).catch(() => undefined);
			break;
		}
		case 'checkout_session.payment.failed':
		case 'payment.failed': {
			// A declined attempt does NOT kill the checkout — the guest can retry the
			// same session — so the order/inventory is left untouched; the abandoned-
			// hold sweep (`expirePendingOrders`) is what eventually releases it. We only
			// record the failed attempt for staff visibility, when it carries our
			// checkout-session metadata (a bare `payment.failed` may not).
			const checkoutSession = event?.data?.attributes?.data;

			if (checkoutSession?.attributes?.metadata?.kind === 'dining') {
				const diningOrderId = checkoutSession.attributes.metadata.diningOrderId as string | undefined;
				const failed = checkoutSession.attributes.payments?.[0] ?? checkoutSession;
				const failedAmount = failed?.attributes?.amount as number | undefined;
				if (diningOrderId && eventId && failedAmount != null) {
					await recordDiningPaymentFailure({
						eventId,
						orderId: diningOrderId,
						sessionId: (checkoutSession.id as string | undefined) ?? null,
						paymentId: (failed?.id as string | undefined) ?? null,
						amountCentavos: failedAmount,
						payload: event
					});
				}
				break;
			}

			const orderId = checkoutSession?.attributes?.metadata?.orderId as string | undefined;
			const payment = checkoutSession?.attributes?.payments?.[0] ?? checkoutSession;
			const paymentId = payment?.id as string | undefined;
			const amountCentavos = payment?.attributes?.amount as number | undefined;
			const currency = (payment?.attributes?.currency as string | undefined) ?? 'PHP';

			if (!orderId || !eventId || amountCentavos == null) {
				console.warn('paymongo webhook: failed payment without linkable order', eventId, type);
				break;
			}

			await db.transaction(async (tx) => {
				const existing = await tx
					.select({ id: payments.id })
					.from(payments)
					.where(eq(payments.paymongoEventId, eventId))
					.then((r) => r.at(0));
				if (existing) return;

				const order = await tx
					.select({ id: orders.id })
					.from(orders)
					.where(eq(orders.id, orderId))
					.then((r) => r.at(0));
				if (!order) {
					console.error('paymongo webhook: failed-payment order not found', orderId);
					return;
				}

				await tx.insert(payments).values({
					orderId: order.id,
					provider: 'paymongo',
					method: 'paymongo',
					purpose: 'settlement',
					paymongoCheckoutSessionId: checkoutSession?.id,
					paymongoPaymentId: paymentId,
					paymongoEventId: eventId,
					status: 'failed',
					amountCentavos,
					currency,
					rawPayload: event
				});
			});
			break;
		}
		// PayMongo's event name is `payment.refund.updated` (dots — as registered on the
		// webhook); the underscore spelling this handler originally listened for never
		// arrives, which silently dropped every refund status update. Both are accepted.
		case 'payment.refund.updated':
		case 'payment.refund_updated':
		case 'payment.refunded': {
			// `refundOrderViaPaymongo` (lib/server/paymongo-refund.ts) already records a
			// *standard* refund as paid at creation time, since that call already confirmed
			// PayMongo accepted it — so for those this is reconciliation only, catching the
			// rarer case where an accepted refund later fails to actually land (card issuer
			// decline, etc.). A *QR Ph* refund is different: it's recorded `pending` at
			// creation (the guest must still open and claim a transfer link), so this is
			// where that one actually gets confirmed — flipping it to paid and posting its
			// cash-out movement only once PayMongo reports it `succeeded`.
			const refund = event?.data?.attributes?.data;
			const refundId = refund?.id as string | undefined;
			const refundStatus = refund?.attributes?.status as string | undefined;

			if (!refundId) {
				console.warn('paymongo webhook: refund event without a refund id', eventId, type);
				break;
			}

			const paymentRow = await db
				.select({
					id: payments.id,
					orderId: payments.orderId,
					status: payments.status,
					amountCentavos: payments.amountCentavos
				})
				.from(payments)
				.where(eq(payments.paymongoRefundId, refundId))
				.then((r) => r.at(0));
			if (!paymentRow) {
				console.warn('paymongo webhook: refund event for an unknown refund', refundId);
				break;
			}

			if (refundStatus === 'succeeded' && paymentRow.status === 'pending') {
				const [order] = await db
					.select({ id: orders.id, hotelId: orders.hotelId })
					.from(orders)
					.where(eq(orders.id, paymentRow.orderId))
					.limit(1);
				if (order) {
					await db
						.update(payments)
						.set({ status: 'paid', paidAt: new Date(), rawPayload: event })
						.where(eq(payments.id, paymentRow.id));

					const [settings] = await db
						.select({
							autoPost: financeSettings.autoPostOnlinePayments,
							undepositedAccountId: financeSettings.undepositedAccountId
						})
						.from(financeSettings)
						.where(eq(financeSettings.hotelId, order.hotelId))
						.limit(1);
					if (settings?.autoPost && settings.undepositedAccountId) {
						const [hotelRow] = await db
							.select({ timezone: hotels.timezone })
							.from(hotels)
							.where(eq(hotels.id, order.hotelId))
							.limit(1);
						try {
							await recordCashMovement({
								hotelId: order.hotelId,
								businessDate: businessDateFor(hotelRow?.timezone ?? 'Asia/Manila'),
								direction: 'out',
								category: 'refund',
								cashAccountId: settings.undepositedAccountId,
								amountCentavos: Math.abs(paymentRow.amountCentavos),
								counterpartyType: 'guest',
								sourceType: 'payment',
								sourceId: paymentRow.id,
								paymentId: paymentRow.id,
								memo: 'Cancellation refund — PayMongo (QR Ph, claimed)'
							});
						} catch (e) {
							console.error(
								'paymongo webhook: could not post QR Ph refund cash movement',
								order.id,
								e
							);
						}
					}
				}
			} else if (refundStatus === 'failed') {
				// Flip the refund's own row to `failed` — the PayMongo transactions list reads
				// this directly, so staff see it there without digging into order history.
				await db
					.update(payments)
					.set({ status: 'failed', rawPayload: event })
					.where(eq(payments.id, paymentRow.id));

				const [order] = await db
					.select({ id: orders.id, status: orders.status })
					.from(orders)
					.where(eq(orders.id, paymentRow.orderId))
					.limit(1);
				if (order) {
					// Self-loop status (no actual transition) just to attach a note — same
					// device the checkout-on-a-cancelled-order case above already uses.
					await db.insert(orderStatusHistory).values({
						orderId: order.id,
						fromStatus: order.status,
						toStatus: order.status,
						note: `PayMongo refund ${refundId} failed after being accepted — needs manual follow-up`
					});
					console.error(
						'paymongo webhook: refund failed after acceptance',
						refundId,
						paymentRow.id
					);
				}
			} else {
				console.log('paymongo webhook: refund status update', refundId, refundStatus);
			}
			break;
		}
		default:
			console.log('paymongo webhook: unhandled event type', type);
	}
}

/** The hotel an event's booking belongs to, or null when it can't be linked to one. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function eventHotelId(event: any): Promise<string | null> {
	const resource = event?.data?.attributes?.data;
	if (resource?.attributes?.metadata?.kind === 'dining') {
		const diningOrderId = resource.attributes.metadata.diningOrderId as string | undefined;
		return diningOrderId ? await diningEventHotelId(diningOrderId) : null;
	}
	const orderId = resource?.attributes?.metadata?.orderId as string | undefined;
	if (orderId) {
		const [o] = await db
			.select({ hotelId: orders.hotelId })
			.from(orders)
			.where(eq(orders.id, orderId))
			.limit(1);
		return o?.hotelId ?? null;
	}
	const refundId = resource?.id as string | undefined;
	if (refundId) {
		const [p] = await db
			.select({ hotelId: orders.hotelId })
			.from(payments)
			.innerJoin(orders, eq(orders.id, payments.orderId))
			.where(eq(payments.paymongoRefundId, refundId))
			.limit(1);
		return p?.hotelId ?? null;
	}
	return null;
}
