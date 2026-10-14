import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from './db/index';
import { bookingRooms, bookings, ratePlans, securityDepositPolicies } from './db/schema/index';

/**
 * rate plan id → the refundable security deposit (centavos, per room) staff will collect at
 * check-in. Plans with no policy, or a policy of zero, are left out. Display only: the deposit
 * is never part of an order total, a downpayment or a PayMongo charge. Hotel-scoped, so a
 * foreign id can never resolve. Mirrors what the check-in screen pre-fills.
 */
export async function securityDepositByRatePlan(
	hotelId: string,
	ratePlanIds: string[]
): Promise<Map<string, number>> {
	const out = new Map<string, number>();
	if (ratePlanIds.length === 0) return out;
	const rows = await db
		.select({ id: ratePlans.id, amount: securityDepositPolicies.amountCentavos })
		.from(ratePlans)
		.innerJoin(securityDepositPolicies, eq(securityDepositPolicies.id, ratePlans.securityDepositPolicyId))
		.where(and(eq(ratePlans.hotelId, hotelId), inArray(ratePlans.id, ratePlanIds)));
	for (const r of rows) if (r.amount > 0) out.set(r.id, r.amount);
	return out;
}

/**
 * The refundable security deposit across every room of one order (deposit × rooms on each line,
 * cancelled lines left out), or 0 when none of its rate plans carries one. For showing the
 * guest on the review page, the confirmation page and the confirmation email; collected by
 * staff at check-in, never by this order's payment.
 */
export async function orderSecurityDepositCentavos(hotelId: string, orderId: string): Promise<number> {
	const [row] = await db
		.select({
			total: sql<number>`coalesce(sum(${securityDepositPolicies.amountCentavos} * ${bookingRooms.quantity}), 0)::bigint`
		})
		.from(bookings)
		.innerJoin(bookingRooms, eq(bookingRooms.bookingId, bookings.id))
		.innerJoin(ratePlans, eq(ratePlans.id, bookingRooms.ratePlanId))
		.innerJoin(securityDepositPolicies, eq(securityDepositPolicies.id, ratePlans.securityDepositPolicyId))
		.where(
			and(
				eq(bookings.hotelId, hotelId),
				eq(bookings.orderId, orderId),
				ne(bookings.status, 'cancelled')
			)
		);
	return Number(row?.total ?? 0);
}
