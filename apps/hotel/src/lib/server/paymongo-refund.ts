import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { PayMongoError, type Refund } from '@mm/paymongo';
import { db } from './db/index';
import { hotels, orders, payments } from './db/schema/index';
import { getPaymongoClient } from './paymongo/client';
import { getFinanceSettings } from './finance/settings';
import { recordCashMovement } from './finance/cash';
import { businessDateFor, FinanceError } from './finance/shared';
import type { SessionUser } from './auth/session';

/** PayMongo rejects a QR Ph-sourced payment from the standard `/refunds` endpoint with
 *  this specific `parameter_invalid` error — the caller can't know a payment's source
 *  in advance, so this is how `refundOrderViaPaymongo` decides to retry via
 *  `createQrPhRefund` instead of treating it as a genuine failure. */
function isQrPhRefundRejection(e: unknown): boolean {
	if (!(e instanceof PayMongoError)) return false;
	const payload = e.payload as { errors?: { detail?: string }[] } | null;
	return !!payload?.errors?.some((err) => err.detail?.toLowerCase().includes('source type qrph'));
}

/** A human sentence for a flat rejection (`createRefund`/`createQrPhRefund` threw —
 *  no refund resource was ever created, e.g. a bad amount or an unrefundable payment).
 *  A refund that *was* created but reports `status: 'failed'` doesn't go through
 *  this — see the `refund.attributes.status === 'failed'` branch below instead,
 *  which has an actual ref id to point staff at. */
function describePayMongoRejection(e: unknown): string {
	if (e instanceof PayMongoError) {
		const payload = e.payload as { errors?: { detail?: string }[] } | null;
		const detail = payload?.errors?.[0]?.detail;
		if (detail) return detail;
		return `PayMongo returned an unexpected error (HTTP ${e.status}).`;
	}
	return e instanceof Error ? e.message : 'Unknown error contacting PayMongo.';
}

/** A `payments` row eligible to be refunded against: paid, online, not itself a refund,
 *  not voided. Reduced by whatever's already been refunded against it (tracked via
 *  `refundsPaymentId`, stored negative on refund rows — same convention `cancelBooking`
 *  already uses). */
async function eligibleOriginPayments(hotelId: string, orderId: string) {
	const origins = await db
		.select({
			id: payments.id,
			amountCentavos: payments.amountCentavos,
			paymongoPaymentId: payments.paymongoPaymentId
		})
		.from(payments)
		.innerJoin(orders, eq(orders.id, payments.orderId))
		.where(
			and(
				eq(payments.orderId, orderId),
				eq(orders.hotelId, hotelId),
				eq(payments.provider, 'paymongo'),
				eq(payments.status, 'paid'),
				ne(payments.purpose, 'refund'),
				isNull(payments.voidedAt)
			)
		)
		.orderBy(asc(payments.createdAt));
	if (origins.length === 0) return [];

	const alreadyRefunded = await db
		.select({
			refundsPaymentId: payments.refundsPaymentId,
			amountCentavos: payments.amountCentavos
		})
		.from(payments)
		.where(
			and(
				eq(payments.orderId, orderId),
				eq(payments.purpose, 'refund'),
				inArray(
					payments.refundsPaymentId,
					origins.map((o) => o.id)
				)
			)
		);
	const refundedByOrigin = new Map<string, number>();
	for (const r of alreadyRefunded) {
		if (!r.refundsPaymentId) continue;
		refundedByOrigin.set(
			r.refundsPaymentId,
			(refundedByOrigin.get(r.refundsPaymentId) ?? 0) + Math.abs(r.amountCentavos)
		);
	}

	return origins.map((o) => ({
		...o,
		remainingCentavos: Math.max(0, o.amountCentavos - (refundedByOrigin.get(o.id) ?? 0))
	}));
}

/** How much of an order can still be refunded through PayMongo — powers the cancel
 *  dialog's "Refund via PayMongo" option and its cap. */
export async function getPaymongoRefundableCentavos(
	hotelId: string,
	orderId: string
): Promise<number> {
	const origins = await eligibleOriginPayments(hotelId, orderId);
	return origins.reduce((sum, o) => sum + o.remainingCentavos, 0);
}

export interface RefundOrderViaPaymongoResult {
	refundedCentavos: number;
	refundPaymentIds: string[];
}

/**
 * Actually returns money to the guest via PayMongo's Refunds API — not just bookkeeping.
 * Splits across the order's eligible original PayMongo payments (oldest first) when one
 * alone can't cover the amount (e.g. a deposit + balance both paid online), since a
 * PayMongo refund can never exceed its own origin payment.
 *
 * Each individual PayMongo refund call, on success, is recorded immediately (its own
 * payments row + a matching cash-out movement out of Undeposited Funds, mirroring how
 * the webhook posted the original payment in) — so if a later call in the same request
 * fails, whatever already succeeded stays recorded rather than lost. Throws a
 * `FinanceError` (caught and re-surfaced by `cancelBooking`) naming any shortfall; the
 * caller must not treat the cancellation as refunded unless this resolves without throwing.
 */
export async function refundOrderViaPaymongo(params: {
	hotelId: string;
	orderId: string;
	amountCentavos: number;
	notes: string;
	actor: SessionUser | null;
}): Promise<RefundOrderViaPaymongoResult> {
	const { hotelId, orderId, amountCentavos, notes, actor } = params;
	if (amountCentavos <= 0) return { refundedCentavos: 0, refundPaymentIds: [] };

	const origins = await eligibleOriginPayments(hotelId, orderId);

	const [hotel] = await db
		.select({ timezone: hotels.timezone })
		.from(hotels)
		.where(eq(hotels.id, hotelId))
		.limit(1);
	const businessDate = businessDateFor(hotel?.timezone ?? 'Asia/Manila');
	const settings = await getFinanceSettings(hotelId);
	const client = getPaymongoClient();

	let remaining = amountCentavos;
	let refundedTotal = 0;
	const refundPaymentIds: string[] = [];

	for (const origin of origins) {
		if (remaining <= 0) break;
		if (!origin.paymongoPaymentId || origin.remainingCentavos <= 0) continue;
		const chunk = Math.min(remaining, origin.remainingCentavos);

		let refund: Refund;
		let viaQrPh = false;
		const shortfallSuffix =
			refundedTotal > 0
				? ` after ₱${(refundedTotal / 100).toFixed(2)} of ₱${(amountCentavos / 100).toFixed(2)} was refunded — the remainder still needs manual handling`
				: '';
		try {
			refund = await client.createRefund({
				paymentId: origin.paymongoPaymentId,
				amount: chunk,
				reason: 'requested_by_customer',
				notes: notes.slice(0, 255)
			});
		} catch (e) {
			if (!isQrPhRefundRejection(e)) {
				throw new FinanceError(
					`PayMongo declined this refund${shortfallSuffix}: ${describePayMongoRejection(e)}`
				);
			}
			viaQrPh = true;
			try {
				refund = await client.createQrPhRefund({
					paymentId: origin.paymongoPaymentId,
					amount: chunk,
					reason: 'requested_by_customer',
					notes: notes.slice(0, 255)
				});
			} catch (e2) {
				throw new FinanceError(
					`PayMongo declined this QR Ph refund${shortfallSuffix}: ${describePayMongoRejection(e2)}`
				);
			}
		}

		if (refund.attributes.status === 'failed') {
			// A refund resource *was* created (recovered from a non-2xx response by
			// `postRefund` in @mm/paymongo) but PayMongo immediately marked it failed —
			// commonly a merchant wallet balance shortfall for a QR Ph transfer, or a
			// sandbox/test-mode limitation. Record it (with its real ref id and the raw
			// response) so it's traceable on the PayMongo Transactions page, rather than
			// vanishing the moment this throws.
			await db.insert(payments).values({
				orderId,
				provider: 'paymongo',
				method: 'paymongo',
				purpose: 'refund',
				status: 'failed',
				amountCentavos: -chunk,
				refundsPaymentId: origin.id,
				paymongoRefundId: refund.id,
				rawPayload: { data: refund },
				recordedByUserId: actor?.id ?? null
			});
			throw new FinanceError(
				`PayMongo${viaQrPh ? ' (QR Ph)' : ''} accepted this refund request and then rejected it (ref ${refund.id})${shortfallSuffix}. See Finance → PayMongo for the full response. Try again, use the PayMongo dashboard directly, or refund via a different method instead.`
			);
		}

		// A standard refund is treated as paid immediately (PayMongo has committed to
		// pushing the money back). QR Ph is different: the response is only a
		// `transfer_link` the *guest* must open and claim — nothing has actually moved
		// yet — so this stays `pending` until the `payment.refund_updated`/`refunded`
		// webhook confirms `succeeded`, which is also when its cash-out movement posts.
		await db.transaction(async (tx) => {
			const [row] = await tx
				.insert(payments)
				.values({
					orderId,
					provider: 'paymongo',
					method: 'paymongo',
					purpose: 'refund',
					status: viaQrPh ? 'pending' : 'paid',
					amountCentavos: -chunk,
					refundsPaymentId: origin.id,
					paymongoRefundId: refund.id,
					rawPayload: { data: refund },
					recordedByUserId: actor?.id ?? null,
					paidAt: viaQrPh ? null : new Date()
				})
				.returning({ id: payments.id });
			refundPaymentIds.push(row!.id);

			if (!viaQrPh && settings.undepositedAccountId) {
				await recordCashMovement(
					{
						hotelId,
						businessDate,
						direction: 'out',
						category: 'refund',
						cashAccountId: settings.undepositedAccountId,
						amountCentavos: chunk,
						counterpartyType: 'guest',
						sourceType: 'payment',
						sourceId: row!.id,
						paymentId: row!.id,
						memo: 'Cancellation refund — PayMongo',
						actor
					},
					tx
				);
			}
		});

		refundedTotal += chunk;
		remaining -= chunk;
	}

	if (remaining > 0) {
		throw new FinanceError(
			refundedTotal > 0
				? `Only ₱${(refundedTotal / 100).toFixed(2)} of ₱${(amountCentavos / 100).toFixed(2)} could be refunded via PayMongo — no further eligible online payment covers the rest.`
				: `No eligible PayMongo payment covers this refund.`
		);
	}

	return { refundedCentavos: refundedTotal, refundPaymentIds };
}
