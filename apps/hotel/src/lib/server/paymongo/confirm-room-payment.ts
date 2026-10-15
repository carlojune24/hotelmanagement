import { and, eq, or } from 'drizzle-orm';
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

/**
 * Records a PayMongo payment against a room / hall order and confirms the booking: the `payments` row, the cash
 * movement into Undeposited Funds, the order + bookings + hall bookings, the audit entry, the Official Receipt and
 * the guest's confirmation email.
 *
 * Two callers, one set of rules: the PayMongo **webhook** (`eventId` = the event's id) and the **verifier**
 * (`paymongo/verify.ts`, which asks PayMongo directly and passes `reconcile:<pay_id>`), so a booking is confirmed
 * even when the webhook never arrives. It is safe to call twice for the same payment: a retried event, or the same
 * `pay_` ID arriving by both routes, is recorded once and the second call is a no-op.
 */
export async function confirmRoomPayment(args: {
	/** The webhook event id, or `reconcile:<pay_id>` when the verifier found the payment. */
	eventId: string;
	orderId: string;
	sessionId: string | null;
	paymentId: string | undefined;
	amountCentavos: number;
	currency: string;
	/** The raw event, or PayMongo's checkout session when the verifier found it. Kept on the payment row. */
	payload: unknown;
}): Promise<{ recorded: boolean; confirmedNow: boolean; paymentRowId: string | null }> {
	const { eventId, orderId, sessionId, paymentId, amountCentavos, currency, payload } = args;

	// Whether *this* delivery is the one that flipped the order to confirmed —
	// gates the one-time guest confirmation email sent after the tx commits.
	const { confirmedNow, auditInfo } = await db.transaction(async (tx) => {
		// Idempotency: a retried delivery of the same event must not double-write, and neither must the same
		// PayMongo payment arriving by two routes (the webhook AND the verifier): a `pay_` ID is recorded once.
		const existing = await tx
			.select({ id: payments.id })
			.from(payments)
			.where(
				or(
					eq(payments.paymongoEventId, eventId),
					paymentId ? and(eq(payments.paymongoPaymentId, paymentId), eq(payments.status, 'paid')) : undefined
				)
			)
			.then((r) => r.at(0));
		if (existing) return { confirmedNow: false, auditInfo: null };

		const order = await tx
			.select()
			.from(orders)
			.where(eq(orders.id, orderId))
			.then((r) => r.at(0));
		if (!order) {
			console.error('paymongo: payment for an order that does not exist', orderId);
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
				paymongoCheckoutSessionId: sessionId ?? order.paymongoCheckoutSessionId,
				paymongoPaymentId: paymentId,
				paymongoEventId: eventId,
				status: 'paid',
				amountCentavos,
				currency,
				rawPayload: payload,
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
			const guestRow = await tx
				.select({ name: guests.fullName })
				.from(guests)
				.where(eq(guests.id, order.guestId))
				.limit(1)
				.then((r) => r.at(0));
			// Why this money came in, in words: a downpayment (and what share of the total) or the full amount.
			const isDownpayment = amountCentavos < order.totalCentavos;
			const reasonMemo = isDownpayment
				? `Online downpayment (PayMongo) — ${order.totalCentavos > 0 ? Math.round((amountCentavos / order.totalCentavos) * 100) : 0}% of the booking total`
				: 'Online full payment (PayMongo)';
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
						counterpartyName: guestRow?.name ?? null,
						sourceType: 'payment',
						sourceId: paymentRow!.id,
						paymentId: paymentRow!.id,
						memo: reasonMemo
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

	return { recorded: auditInfo !== null, confirmedNow, paymentRowId: auditInfo?.paymentId ?? null };
}
