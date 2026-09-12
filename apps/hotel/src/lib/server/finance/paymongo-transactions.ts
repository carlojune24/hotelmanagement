import { and, desc, eq, ne } from 'drizzle-orm';
import { db } from '../db/index';
import { guests, orders, payments } from '../db/schema/index';

export interface PaymongoTransactionRow {
	id: string;
	purpose: 'deposit' | 'settlement' | 'balance' | 'refund';
	status: 'pending' | 'paid' | 'failed';
	amountCentavos: number;
	currency: string;
	orderId: string;
	guestName: string | null;
	paymongoPaymentId: string | null;
	paymongoRefundId: string | null;
	paymongoCheckoutSessionId: string | null;
	paymongoEventId: string | null;
	rawPayload: unknown;
	createdAt: Date;
	paidAt: Date | null;
}

/**
 * Every PayMongo-sourced `payments` row (real online checkouts and the PayMongo
 * refunds `refundOrderViaPaymongo` issues) — "what happened to a particular
 * transaction," in one list, with the raw webhook payload each row was built
 * from for actual troubleshooting.
 */
export async function listPaymongoTransactions(
	hotelId: string,
	filter?: { status?: 'pending' | 'paid' | 'failed'; purpose?: 'settlement' | 'refund' }
): Promise<PaymongoTransactionRow[]> {
	const rows = await db
		.select({
			id: payments.id,
			purpose: payments.purpose,
			status: payments.status,
			amountCentavos: payments.amountCentavos,
			currency: payments.currency,
			orderId: payments.orderId,
			guestName: guests.fullName,
			paymongoPaymentId: payments.paymongoPaymentId,
			paymongoRefundId: payments.paymongoRefundId,
			paymongoCheckoutSessionId: payments.paymongoCheckoutSessionId,
			paymongoEventId: payments.paymongoEventId,
			rawPayload: payments.rawPayload,
			createdAt: payments.createdAt,
			paidAt: payments.paidAt
		})
		.from(payments)
		.innerJoin(orders, eq(orders.id, payments.orderId))
		.innerJoin(guests, eq(guests.id, orders.guestId))
		.where(
			and(
				eq(orders.hotelId, hotelId),
				eq(payments.provider, 'paymongo'),
				filter?.status ? eq(payments.status, filter.status) : undefined,
				// "Settlement" here means "any non-refund purpose" (deposit/settlement/balance)
				// — everything that isn't money going back out.
				filter?.purpose === 'refund'
					? eq(payments.purpose, 'refund')
					: filter?.purpose === 'settlement'
						? ne(payments.purpose, 'refund')
						: undefined
			)
		)
		.orderBy(desc(payments.createdAt))
		.limit(500);

	return rows;
}
