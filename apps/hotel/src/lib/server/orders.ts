import { and, eq, inArray, lte } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from './db/index';
import {
	bookings,
	bookingStatusHistory,
	hallBookings,
	hallBookingStatusHistory,
	orders,
	orderStatusHistory
} from './db/schema/index';
import { writeAudit } from './audit';
import { expireCheckoutSession } from './paymongo/checkout';
import type { SessionUser } from './auth/session';

/**
 * How long an order may sit in `pending_payment` before its held inventory is
 * released. Matches PayMongo's default hosted-checkout-session lifetime (60 min)
 * so a guest can't complete payment after we've given the room away — a late
 * `checkout_session.payment.paid` for an already-expired order is still recorded
 * by the webhook (money is never dropped) and flagged for a staff refund.
 * Override with `PENDING_ORDER_TTL_MINUTES`; floored at 5.
 */
export const PENDING_ORDER_TTL_MINUTES = (() => {
	const raw = Number(env.PENDING_ORDER_TTL_MINUTES);
	return Number.isFinite(raw) && raw >= 5 ? Math.floor(raw) : 60;
})();

type ExpiryCandidate = { id: string; status: string; createdAt: Date };

/**
 * Pure split of candidate orders into those whose hold has lapsed and those to
 * keep. An order expires only while still `pending_payment` and at least
 * `ttlMs` old (boundary inclusive). Extracted for unit testing — the DB
 * orchestration in {@link expirePendingOrders} is thin around this.
 */
export function partitionExpiredOrders<T extends ExpiryCandidate>(
	rows: T[],
	opts: { now: Date; ttlMs: number }
): { expired: T[]; kept: T[] } {
	const cutoff = opts.now.getTime() - opts.ttlMs;
	const expired: T[] = [];
	const kept: T[] = [];
	for (const row of rows) {
		if (row.status === 'pending_payment' && row.createdAt.getTime() <= cutoff) expired.push(row);
		else kept.push(row);
	}
	return { expired, kept };
}

/**
 * Releases inventory held by stale unpaid orders: any `pending_payment` order
 * older than the TTL is moved to `cancelled`, cascading to its `bookings` and
 * `hallBookings` lines (each with a status-history row). Never touches a paid,
 * confirmed, or already-cancelled order.
 *
 * Safe to call opportunistically (it runs on the storefront + front-desk loads)
 * and concurrently — every transition is a guarded `WHERE status = 'pending_payment'`
 * update, so a racing payment webhook or a second sweep simply no-ops. A future
 * cron/night-audit can call this with no `hotelId` to sweep every tenant.
 */
export async function expirePendingOrders(opts?: {
	hotelId?: string;
	now?: Date;
	ttlMinutes?: number;
	actor?: SessionUser | null;
	reason?: string;
}): Promise<{ expiredOrderIds: string[] }> {
	const now = opts?.now ?? new Date();
	const ttlMinutes = opts?.ttlMinutes ?? PENDING_ORDER_TTL_MINUTES;
	const cutoff = new Date(now.getTime() - ttlMinutes * 60_000);
	const note = opts?.reason ?? `Expired — payment not completed within ${ttlMinutes} min`;

	const candidates = await db
		.select({
			id: orders.id,
			hotelId: orders.hotelId,
			checkoutSessionId: orders.paymongoCheckoutSessionId
		})
		.from(orders)
		.where(
			and(
				eq(orders.status, 'pending_payment'),
				lte(orders.createdAt, cutoff),
				opts?.hotelId ? eq(orders.hotelId, opts.hotelId) : undefined
			)
		);
	if (candidates.length === 0) return { expiredOrderIds: [] };

	const expiredOrderIds: string[] = [];
	for (const candidate of candidates) {
		const didExpire = await db.transaction(async (tx) => {
			const updated = await tx
				.update(orders)
				.set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
				.where(and(eq(orders.id, candidate.id), eq(orders.status, 'pending_payment')))
				.returning({ id: orders.id });
			if (updated.length === 0) return false; // paid or swept out from under us

			await tx.insert(orderStatusHistory).values({
				orderId: candidate.id,
				fromStatus: 'pending_payment',
				toStatus: 'cancelled',
				note
			});

			const pendingBookings = await tx
				.select({ id: bookings.id })
				.from(bookings)
				.where(and(eq(bookings.orderId, candidate.id), eq(bookings.status, 'pending_payment')));
			if (pendingBookings.length > 0) {
				const ids = pendingBookings.map((b) => b.id);
				await tx
					.update(bookings)
					.set({ status: 'cancelled', updatedAt: now })
					.where(inArray(bookings.id, ids));
				await tx.insert(bookingStatusHistory).values(
					ids.map((bookingId) => ({
						bookingId,
						fromStatus: 'pending_payment' as const,
						toStatus: 'cancelled' as const,
						note
					}))
				);
			}

			const pendingHalls = await tx
				.select({ id: hallBookings.id })
				.from(hallBookings)
				.where(and(eq(hallBookings.orderId, candidate.id), eq(hallBookings.status, 'pending_payment')));
			if (pendingHalls.length > 0) {
				const ids = pendingHalls.map((h) => h.id);
				await tx
					.update(hallBookings)
					.set({ status: 'cancelled' })
					.where(inArray(hallBookings.id, ids));
				await tx.insert(hallBookingStatusHistory).values(
					ids.map((hallBookingId) => ({
						hallBookingId,
						fromStatus: 'pending_payment' as const,
						toStatus: 'cancelled' as const,
						note
					}))
				);
			}

			return true;
		});

		if (!didExpire) continue;
		expiredOrderIds.push(candidate.id);

		// Best-effort: kill the hosted checkout so a guest can't pay a released hold.
		// The webhook still records a late payment defensively, so a failure here is
		// non-fatal.
		if (candidate.checkoutSessionId) {
			try {
				await expireCheckoutSession(candidate.checkoutSessionId);
			} catch (e) {
				console.error('expirePendingOrders: could not expire checkout session', candidate.id, e);
			}
		}

		try {
			await writeAudit({
				hotelId: candidate.hotelId,
				actor: opts?.actor ?? null,
				action: 'booking.order_expired',
				entityType: 'order',
				entityId: candidate.id,
				after: { ttlMinutes, cutoff: cutoff.toISOString() }
			});
		} catch (e) {
			console.error('expirePendingOrders: could not write audit', candidate.id, e);
		}
	}

	return { expiredOrderIds };
}
