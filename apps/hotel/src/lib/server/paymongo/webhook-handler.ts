import { and, eq } from 'drizzle-orm';
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
import { getBirSettings, issueOfficialReceipt } from '$lib/server/finance/documents';
import { businessDateFor } from '$lib/server/finance/shared';
import { sendBookingConfirmation } from '$lib/server/email/send-booking-confirmation';
import { writeAudit } from '$lib/server/audit';

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
			const { confirmedNow, auditInfo } = await db.transaction(async (tx) => {
				// Idempotency: a retried delivery of the same event must not double-write.
				const existing = await tx
					.select({ id: payments.id })
					.from(payments)
					.where(eq(payments.paymongoEventId, eventId))
					.then((r) => r.at(0));
				if (existing) return { confirmedNow: false, auditInfo: null };

				const order = await tx
					.select()
					.from(orders)
					.where(eq(orders.id, orderId))
					.then((r) => r.at(0));
				if (!order) {
					console.error('paymongo webhook: order not found', orderId);
					return { confirmedNow: false, auditInfo: null };
				}

				const [paymentRow] = await tx
					.insert(payments)
					.values({
						orderId: order.id,
						provider: 'paymongo',
						method: 'paymongo',
						// Less than the order total = a downpayment; the balance is settled at
						// the hotel (a later `recordPayment`). No amount is rejected here — money
						// PayMongo actually took is always recorded.
						purpose: amountCentavos < order.totalCentavos ? 'deposit' : 'settlement',
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

				const expectedNow = order.amountDueNowCentavos ?? order.totalCentavos;
				// The guest may pay the downpayment OR the whole total (both are offered at checkout).
				if (amountCentavos !== expectedNow && amountCentavos !== order.totalCentavos) {
					console.warn(
						`paymongo webhook: order ${order.id} paid ${amountCentavos}, expected ${expectedNow}`
					);
				}

				// A payment row now exists regardless of how this closure exits below —
				// the audit entry (written after commit) must fire for all of them, not
				// just the "advanced the order" path.
				const auditInfo = {
					hotelId: order.hotelId,
					paymentId: paymentRow!.id,
					amountCentavos,
					currency
				};

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
					return { confirmedNow: false, auditInfo };
				}

				// Only advance an order that's still awaiting payment — never clobber a
				// further-advanced status.
				if (order.status !== 'pending_payment') return { confirmedNow: false, auditInfo };

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

				return { confirmedNow: true, auditInfo };
			});

			// Audit trail for the payment itself — every branch above that actually
			// inserted a `payments` row reaches here with a non-null `auditInfo`; only
			// the idempotency-skip (a retried webhook delivery) leaves it null.
			if (auditInfo) {
				await writeAudit({
					hotelId: auditInfo.hotelId,
					actor: null,
					action: 'payment.paymongo_confirmed',
					entityType: 'order',
					entityId: orderId,
					after: {
						paymentId: auditInfo.paymentId,
						amountCentavos: auditInfo.amountCentavos,
						currency: auditInfo.currency,
						paymongoEventId: eventId,
						confirmedOrder: confirmedNow
					}
				});
			}

			// Official Receipt for the online payment, same as a front-desk `recordPayment`
			// — issued before the confirmation email so the email can attach it. Never fail
			// the webhook over a document post (e.g. no active OR series): the OR still
			// issues on first print from the staff side.
			if (auditInfo) {
				const bir = await getBirSettings(auditInfo.hotelId).catch(() => null);
				if (bir?.autoIssueReceiptOnPayment) {
					try {
						await issueOfficialReceipt(auditInfo.hotelId, auditInfo.paymentId, null);
					} catch (e) {
						console.warn(
							'paymongo webhook: could not issue official receipt',
							auditInfo.paymentId,
							e
						);
					}
				}
			}

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
