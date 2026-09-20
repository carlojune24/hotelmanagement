import { and, eq, inArray } from 'drizzle-orm';
import { db } from './db/index';
import { cancellationPolicies, ratePlans } from './db/schema/index';

/** rate plan id → its cancellation policy's `downpaymentBps` (null = pay in full: no policy,
 *  or a policy with no downpayment set). Hotel-scoped, so a foreign id can never resolve. */
export async function downpaymentBpsByRatePlan(
	hotelId: string,
	ratePlanIds: string[]
): Promise<Map<string, number | null>> {
	const out = new Map<string, number | null>();
	if (ratePlanIds.length === 0) return out;
	const rows = await db
		.select({ id: ratePlans.id, bps: cancellationPolicies.downpaymentBps })
		.from(ratePlans)
		.leftJoin(cancellationPolicies, eq(cancellationPolicies.id, ratePlans.cancellationPolicyId))
		.where(and(eq(ratePlans.hotelId, hotelId), inArray(ratePlans.id, ratePlanIds)));
	for (const r of rows) out.set(r.id, r.bps ?? null);
	return out;
}
