import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index';
import { paymentAttempts, type PaymentAttemptRow } from '../db/schema/index';
import { getPaymongoClient } from './client';

/**
 * The record of every checkout session we start (see `payment_attempts`). Written the moment PayMongo hands back a
 * session, so no payment can ever exist at PayMongo without a row here that says whose it is.
 */
export async function recordAttempt(args: {
	hotelId: string;
	scope: 'room' | 'dining';
	orderId?: string | null;
	diningOrderId?: string | null;
	sessionId: string;
	amountCentavos: number;
}): Promise<string> {
	const [row] = await db
		.insert(paymentAttempts)
		.values({
			hotelId: args.hotelId,
			scope: args.scope,
			orderId: args.orderId ?? null,
			diningOrderId: args.diningOrderId ?? null,
			checkoutSessionId: args.sessionId,
			amountCentavos: args.amountCentavos
		})
		.onConflictDoUpdate({
			target: [paymentAttempts.hotelId, paymentAttempts.checkoutSessionId],
			set: { amountCentavos: args.amountCentavos }
		})
		.returning({ id: paymentAttempts.id });
	return row!.id;
}

/** The order's open attempts, newest first. */
export async function openAttempts(target: { orderId: string } | { diningOrderId: string }): Promise<PaymentAttemptRow[]> {
	const where = 'orderId' in target ? eq(paymentAttempts.orderId, target.orderId) : eq(paymentAttempts.diningOrderId, target.diningOrderId);
	return db.select().from(paymentAttempts).where(and(where, eq(paymentAttempts.status, 'open'))).orderBy(desc(paymentAttempts.createdAt));
}

/**
 * An earlier checkout link the guest can still use: still payable at PayMongo and for the same amount. "Continue to
 * payment" goes back to it instead of creating a second session, so one booking does not pile up payable links.
 */
export async function reusableCheckoutUrl(
	hotelId: string,
	target: { orderId: string },
	amountCentavos: number
): Promise<string | null> {
	const open = (await openAttempts(target)).filter((a) => a.amountCentavos === amountCentavos);
	if (open.length === 0) return null;
	const client = await getPaymongoClient(hotelId).catch(() => null);
	if (!client) return null;
	for (const a of open) {
		try {
			const session = await client.retrieveCheckoutSession(a.checkoutSessionId);
			if (session.attributes.status === 'active' && !(session.attributes.payments ?? []).some((p) => p.attributes?.status === 'paid')) {
				return session.attributes.checkout_url;
			}
		} catch {
			// Can't tell: fall through to a fresh session.
		}
	}
	return null;
}

/** An earlier open session is replaced: expire it at PayMongo and keep its row as history (status `expired`). */
export async function supersedeOpenAttempts(
	hotelId: string,
	target: { orderId: string } | { diningOrderId: string },
	exceptSessionId?: string
): Promise<void> {
	const client = await getPaymongoClient(hotelId).catch(() => null);
	for (const a of await openAttempts(target)) {
		if (a.checkoutSessionId === exceptSessionId) continue;
		await client?.expireCheckoutSession(a.checkoutSessionId).catch(() => {});
		await db.update(paymentAttempts).set({ status: 'expired', resolvedAt: new Date() }).where(eq(paymentAttempts.id, a.id));
	}
}
