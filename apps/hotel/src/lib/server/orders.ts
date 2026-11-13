import { and, eq, gt, inArray, lt, min, sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { zonedToUtc } from '$lib/dining-slots';
import { db } from './db/index';
import {
	bookingRooms,
	bookings,
	bookingStatusHistory,
	hallBookings,
	hallBookingStatusHistory,
	hotels,
	orders,
	orderStatusHistory,
	roomTypes
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

/**
 * When an order's current unpaid hold began. Normally the order's own creation (the
 * storefront writes a `null -> pending_payment` history row in the same transaction), but
 * a staff *reinstate* re-enters `pending_payment` long after creation
 * (`status-override.ts`) — its hold has to start there, or the sweep below would release
 * it the instant it was reinstated.
 */
const holdStartedAt = () => sql`coalesce((
		select max(h.created_at) from order_status_history h
		where h.order_id = ${orders.id} and h.to_status = 'pending_payment'
	), ${orders.createdAt})`;

/** Single-order version of {@link holdStartedAt}, for emails that quote the hold deadline. */
export async function getHoldStartedAt(order: { id: string; createdAt: Date }): Promise<Date> {
	const [row] = await db
		.select({ at: sql<Date | null>`max(${orderStatusHistory.createdAt})`.mapWith(orderStatusHistory.createdAt) })
		.from(orderStatusHistory)
		.where(and(eq(orderStatusHistory.orderId, order.id), eq(orderStatusHistory.toStatus, 'pending_payment')));
	return row?.at ?? order.createdAt;
}

/** An unpaid hold normally lasts until this many hours before check-in... */
export const HOLD_BEFORE_CHECKIN_HOURS = 24;
/** ...but never longer than this after the hold began, so an unpaid far-ahead booking can't block a room for months. */
export const HOLD_MAX_DAYS = 3;

/** Which limit set the deadline: `checkin` = 1 day before check-in, `cap` = the max-days cap, `ttl` = the short floor. */
export type HoldRule = 'checkin' | 'cap' | 'ttl';

/**
 * When an unpaid hold lapses: `max(holdStart + ttl, min(checkInAt − 24h, holdStart + 3 days))`.
 * A booking made inside the last day before check-in therefore keeps the short ttl hold, and
 * `checkInAt: null` (no dated line) does too. Pure; the sweep, the front-desk list and the emails
 * all go through it so they can never disagree.
 */
export function computeHoldDeadline(input: {
	holdStart: Date;
	checkInAt: Date | null;
	ttlMinutes?: number;
}): { at: Date; rule: HoldRule } {
	const start = input.holdStart.getTime();
	const floor = start + (input.ttlMinutes ?? PENDING_ORDER_TTL_MINUTES) * 60_000;
	if (!input.checkInAt) return { at: new Date(floor), rule: 'ttl' };
	const beforeCheckIn = input.checkInAt.getTime() - HOLD_BEFORE_CHECKIN_HOURS * 3_600_000;
	const cap = start + HOLD_MAX_DAYS * 86_400_000;
	const wanted = Math.min(beforeCheckIn, cap);
	if (wanted <= floor) return { at: new Date(floor), rule: 'ttl' };
	return { at: new Date(wanted), rule: beforeCheckIn <= cap ? 'checkin' : 'cap' };
}

/** Earliest room check-in / hall event date per order, as `YYYY-MM-DD`. */
async function earliestStartByOrder(orderIds: string[]): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	if (orderIds.length === 0) return out;
	const [rooms, halls] = await Promise.all([
		db
			.select({ orderId: bookings.orderId, d: min(bookings.checkIn) })
			.from(bookings)
			.where(inArray(bookings.orderId, orderIds))
			.groupBy(bookings.orderId),
		db
			.select({ orderId: hallBookings.orderId, d: min(hallBookings.eventDate) })
			.from(hallBookings)
			.where(inArray(hallBookings.orderId, orderIds))
			.groupBy(hallBookings.orderId)
	]);
	for (const r of [...rooms, ...halls]) {
		if (r.orderId && r.d && (!out.has(r.orderId) || r.d < out.get(r.orderId)!)) out.set(r.orderId, r.d);
	}
	return out;
}

/** `startDate` is the earliest check-in date; it is read at the hotel's own check-in time and timezone. */
function deadlineFor(
	holdStart: Date,
	startDate: string | undefined,
	hotel: { timezone: string; checkInTime: string },
	ttlMinutes?: number
) {
	const checkInAt = startDate ? zonedToUtc(startDate, hotel.checkInTime.slice(0, 5), hotel.timezone) : null;
	return computeHoldDeadline({ holdStart, checkInAt, ttlMinutes });
}

/** The hold deadline for one order — what the guest emails quote. */
export async function getHoldDeadline(order: {
	id: string;
	hotelId: string;
	createdAt: Date;
}): Promise<{ at: Date; rule: HoldRule }> {
	const [holdStart, starts, [hotel]] = await Promise.all([
		getHoldStartedAt(order),
		earliestStartByOrder([order.id]),
		db
			.select({ timezone: hotels.timezone, checkInTime: hotels.checkInTime })
			.from(hotels)
			.where(eq(hotels.id, order.hotelId))
	]);
	if (!hotel) return computeHoldDeadline({ holdStart, checkInAt: null });
	return deadlineFor(holdStart, starts.get(order.id), hotel);
}

export interface UnpaidHold {
	roomTypeName: string;
	rooms: number;
	checkIn: string;
	checkOut: string;
	/** When the hold lapses on its own if the guest never pays. */
	expiresAtIso: string;
}

/**
 * Rooms held by an online checkout that has not been paid yet (`pending_payment`) for any night in
 * `[checkIn, checkOut)`. They count as booked until paid or expired, which is why a walk-in
 * "check availability" can come back empty right after a guest starts an online booking — this
 * names those holds and when each releases itself.
 */
export async function listUnpaidHolds(
	hotelId: string,
	checkIn: string,
	checkOut: string
): Promise<UnpaidHold[]> {
	const rows = await db
		.select({
			orderId: orders.id,
			roomTypeName: roomTypes.name,
			quantity: bookingRooms.quantity,
			checkIn: bookings.checkIn,
			checkOut: bookings.checkOut,
			orderCreatedAt: holdStartedAt().mapWith(orders.createdAt)
		})
		.from(bookings)
		.innerJoin(orders, eq(orders.id, bookings.orderId))
		.innerJoin(bookingRooms, eq(bookingRooms.bookingId, bookings.id))
		.innerJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId))
		.where(
			and(
				eq(bookings.hotelId, hotelId),
				eq(bookings.status, 'pending_payment'),
				eq(orders.status, 'pending_payment'),
				lt(bookings.checkIn, checkOut),
				gt(bookings.checkOut, checkIn)
			)
		);
	if (rows.length === 0) return [];
	const [[hotel], starts] = await Promise.all([
		db.select({ timezone: hotels.timezone, checkInTime: hotels.checkInTime }).from(hotels).where(eq(hotels.id, hotelId)),
		earliestStartByOrder([...new Set(rows.map((r) => r.orderId))])
	]);
	return rows
		.map((r) => ({
			roomTypeName: r.roomTypeName,
			rooms: r.quantity,
			checkIn: r.checkIn,
			checkOut: r.checkOut,
			expiresAtIso: (hotel
				? deadlineFor(r.orderCreatedAt, starts.get(r.orderId), hotel)
				: computeHoldDeadline({ holdStart: r.orderCreatedAt, checkInAt: null })
			).at.toISOString()
		}))
		.sort((a, b) => a.expiresAtIso.localeCompare(b.expiresAtIso));
}

type ExpiryCandidate = { id: string; status: string; createdAt: Date };

/**
 * Pure split of candidate orders into those whose hold has lapsed and those to
 * keep. An order expires only while still `pending_payment` and held for at least
 * `ttlMs` — `createdAt` here is the hold's start (see {@link holdStartedAt}),
 * which is not the order's creation for a reinstated booking. Boundary inclusive.
 * Extracted for unit testing — the DB orchestration in
 * {@link expirePendingOrders} is thin around this.
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
	const note = opts?.reason ?? 'Expired — payment not completed before the hold lapsed';

	// The short ttl is the earliest any hold can lapse, so this cheap query narrows to orders that *might* be
	// due; the real deadline (up to 1 day before check-in) is applied just below.
	const maybeDue = await db
		.select({
			id: orders.id,
			hotelId: orders.hotelId,
			holdStartedAt: holdStartedAt().mapWith(orders.createdAt),
			checkoutSessionId: orders.paymongoCheckoutSessionId,
			timezone: hotels.timezone,
			checkInTime: hotels.checkInTime
		})
		.from(orders)
		.innerJoin(hotels, eq(hotels.id, orders.hotelId))
		.where(
			and(
				eq(orders.status, 'pending_payment'),
				sql`${holdStartedAt()} <= ${cutoff.toISOString()}::timestamptz`,
				opts?.hotelId ? eq(orders.hotelId, opts.hotelId) : undefined
			)
		);
	if (maybeDue.length === 0) return { expiredOrderIds: [] };
	const starts = await earliestStartByOrder(maybeDue.map((o) => o.id));
	const candidates = maybeDue
		.map((o) => ({ ...o, deadline: deadlineFor(o.holdStartedAt, starts.get(o.id), o, ttlMinutes) }))
		.filter((o) => o.deadline.at.getTime() <= now.getTime());
	if (candidates.length === 0) return { expiredOrderIds: [] };

	const expiredOrderIds: string[] = [];
	for (const candidate of candidates) {
		// Ask PayMongo before giving the room away: a guest may have paid while our webhook was unreachable. Then the
		// booking is confirmed instead. If PayMongo cannot be asked, wait (up to a day) rather than release a room that
		// may already be paid for.
		const { verifyOrderNow } = await import('./paymongo/verify');
		const verified = await verifyOrderNow({ orderId: candidate.id }, 0, 'hold_sweep').catch(() => null);
		if (verified?.paid) continue;
		if (verified?.unknown && now.getTime() - candidate.holdStartedAt.getTime() < 24 * 60 * 60_000)
			continue;

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
				await expireCheckoutSession(candidate.hotelId, candidate.checkoutSessionId);
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
				after: { ttlMinutes, cutoff: cutoff.toISOString(), deadline: candidate.deadline.at.toISOString(), rule: candidate.deadline.rule }
			});
		} catch (e) {
			console.error('expirePendingOrders: could not write audit', candidate.id, e);
		}
	}

	return { expiredOrderIds };
}
