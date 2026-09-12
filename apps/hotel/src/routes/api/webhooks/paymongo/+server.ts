import { verifyPaymongoWebhookSignature } from '@mm/paymongo';
import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db/index';
import {
	bookings,
	bookingStatusHistory,
	financeSettings,
	hallBookings,
	hallBookingStatusHistory,
	hotels,
	orders,
	orderStatusHistory,
	payments
} from '$lib/server/db/schema/index';
import { recordCashMovement } from '$lib/server/finance/cash';
import { businessDateFor } from '$lib/server/finance/shared';
import { sendBookingConfirmation } from '$lib/server/email/send-booking-confirmation';

export async function POST({ request }) {
	const secret = env.PAYMONGO_WEBHOOK_SECRET;
	if (!secret) throw error(500, 'PAYMONGO_WEBHOOK_SECRET is not set');

	const signatureHeader = request.headers.get('paymongo-signature');
	if (!signatureHeader) throw error(400, 'Missing Paymongo-Signature header');

	const rawBody = await request.text();
	if (!verifyPaymongoWebhookSignature(rawBody, signatureHeader, secret)) {
		throw error(400, 'Invalid signature');
	}

	const event = JSON.parse(rawBody);
	const type = event?.data?.attributes?.type as string | undefined;
	const eventId = event?.data?.id as string | undefined;

	switch (type) {
		case 'checkout_session.payment.paid': {
			// The webhook's resource is the Checkout Session itself, carrying our
			// `metadata.orderId` and its associated Payment(s) — not a bare payment object.
			const checkoutSession = event?.data?.attributes?.data;
			const orderId = checkoutSession?.attributes?.metadata?.orderId as string | undefined;
			const payment = checkoutSession?.attributes?.payments?.[0];
			const paymentId = payment?.id as string | undefined;
			const amountCentavos = payment?.attributes?.amount as number | undefined;
			const currency = (payment?.attributes?.currency as string | undefined) ?? 'PHP';

			if (!orderId || !eventId || amountCentavos == null) {
				console.error('paymongo webhook: missing orderId/eventId/amount on payload', event);
				break;
			}

			// Whether *this* delivery is the one that flipped the order to confirmed —
			// gates the one-time guest confirmation email sent after the tx commits.
			const confirmedNow = await db.transaction(async (tx) => {
				// Idempotency: a retried delivery of the same event must not double-write.
				const existing = await tx
					.select({ id: payments.id })
					.from(payments)
					.where(eq(payments.paymongoEventId, eventId))
					.then((r) => r.at(0));
				if (existing) return false;

				const order = await tx
					.select()
					.from(orders)
					.where(eq(orders.id, orderId))
					.then((r) => r.at(0));
				if (!order) {
					console.error('paymongo webhook: order not found', orderId);
					return false;
				}

				const [paymentRow] = await tx
					.insert(payments)
					.values({
						orderId: order.id,
						provider: 'paymongo',
						method: 'paymongo',
						purpose: 'settlement',
						paymongoCheckoutSessionId: checkoutSession?.id ?? order.paymongoCheckoutSessionId,
						paymongoPaymentId: paymentId,
						paymongoEventId: eventId,
						status: 'paid',
						amountCentavos,
						currency,
						rawPayload: event,
						paidAt: new Date()
					})
					.returning({ id: payments.id });

				// Post the receipt to Finance's Undeposited Funds account so it shows in
				// cash-in / revenue reports; a later PayMongo payout is recorded as a
				// transfer out of Undeposited into the bank.
				const [settings] = await tx
					.select({
						autoPost: financeSettings.autoPostOnlinePayments,
						undepositedAccountId: financeSettings.undepositedAccountId
					})
					.from(financeSettings)
					.where(eq(financeSettings.hotelId, order.hotelId))
					.limit(1);
				if (settings?.autoPost && settings.undepositedAccountId) {
					const [hotelRow] = await tx
						.select({ timezone: hotels.timezone })
						.from(hotels)
						.where(eq(hotels.id, order.hotelId))
						.limit(1);
					const hasHall = await tx
						.select({ id: hallBookings.id })
						.from(hallBookings)
						.where(eq(hallBookings.orderId, order.id))
						.limit(1)
						.then((r) => r.length > 0);
					try {
						await recordCashMovement(
							{
								hotelId: order.hotelId,
								businessDate: businessDateFor(hotelRow?.timezone ?? 'Asia/Manila'),
								direction: 'in',
								category: hasHall ? 'hall_revenue' : 'room_revenue',
								cashAccountId: settings.undepositedAccountId,
								amountCentavos,
								counterpartyType: 'guest',
								sourceType: 'payment',
								sourceId: paymentRow!.id,
								paymentId: paymentRow!.id,
								memo: 'Online payment (PayMongo)'
							},
							tx
						);
					} catch (e) {
						// Never fail a real payment over a bookkeeping post (e.g. a closed day) —
						// log it for manual reconciliation instead.
						console.error('paymongo webhook: could not post cash movement', order.id, e);
					}
				}

				// A payment that lands after the order's hold already lapsed (see
				// `lib/server/orders.ts`'s `expirePendingOrders`): the room may have been
				// released or re-sold. The payment + cash movement above are kept so money
				// is never dropped — flag it for a staff refund and do not re-confirm.
				if (order.status === 'cancelled') {
					await tx.insert(orderStatusHistory).values({
						orderId: order.id,
						fromStatus: 'cancelled',
						toStatus: 'cancelled',
						note: 'Payment received on a cancelled order — refund required'
					});
					console.error(
						'paymongo webhook: payment on cancelled order — needs refund',
						order.id,
						paymentRow!.id
					);
					return false;
				}

				// Only advance an order that's still awaiting payment — never clobber a
				// further-advanced status.
				if (order.status !== 'pending_payment') return false;

				await tx
					.update(orders)
					.set({ status: 'confirmed', updatedAt: new Date() })
					.where(and(eq(orders.id, order.id), eq(orders.status, 'pending_payment')));
				await tx.insert(orderStatusHistory).values({
					orderId: order.id,
					fromStatus: 'pending_payment',
					toStatus: 'confirmed',
					note: 'PayMongo checkout session paid'
				});

				// Fan out: confirm every still-pending line under this order (room stays
				// and/or hall reservations — this pass only ever has one of the former, but
				// the loop already generalizes to whatever the cart/checkout pass adds).
				const pendingBookings = await tx
					.select()
					.from(bookings)
					.where(and(eq(bookings.orderId, order.id), eq(bookings.status, 'pending_payment')));
				for (const b of pendingBookings) {
					await tx
						.update(bookings)
						.set({ status: 'confirmed', updatedAt: new Date() })
						.where(and(eq(bookings.id, b.id), eq(bookings.status, 'pending_payment')));
					await tx.insert(bookingStatusHistory).values({
						bookingId: b.id,
						fromStatus: 'pending_payment',
						toStatus: 'confirmed',
						note: 'PayMongo checkout session paid'
					});
				}

				const pendingHalls = await tx
					.select()
					.from(hallBookings)
					.where(
						and(eq(hallBookings.orderId, order.id), eq(hallBookings.status, 'pending_payment'))
					);
				for (const h of pendingHalls) {
					await tx
						.update(hallBookings)
						.set({ status: 'confirmed' })
						.where(and(eq(hallBookings.id, h.id), eq(hallBookings.status, 'pending_payment')));
					await tx.insert(hallBookingStatusHistory).values({
						hallBookingId: h.id,
						fromStatus: 'pending_payment',
						toStatus: 'confirmed',
						note: 'PayMongo checkout session paid'
					});
				}

				return true;
			});

			// Guest confirmation email — after the tx commits, only on the delivery
			// that actually confirmed the order. Best-effort: a mail failure is logged
			// (and to `email_log`), never surfaced to PayMongo.
			if (confirmedNow) {
				await sendBookingConfirmation(orderId).catch((e) =>
					console.error('paymongo webhook: confirmation email failed', orderId, e)
				);
			}
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
							console.error('paymongo webhook: could not post QR Ph refund cash movement', order.id, e);
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
					console.error('paymongo webhook: refund failed after acceptance', refundId, paymentRow.id);
				}
			} else {
				console.log('paymongo webhook: refund status update', refundId, refundStatus);
			}
			break;
		}
		default:
			console.log('paymongo webhook: unhandled event type', type);
	}

	return json({ received: true });
}
