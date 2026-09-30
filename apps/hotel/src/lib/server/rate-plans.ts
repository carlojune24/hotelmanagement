import { and, eq, isNull } from 'drizzle-orm';
import { db } from './db/index';
import {
	cancellationPolicies,
	ratePlans,
	roomTypes,
	securityDepositPolicies
} from './db/schema/index';

/** Thrown when an id posted to a settings action doesn't belong to the caller's hotel. The
 *  message is safe to show the admin — it never says whether the id exists elsewhere. */
export class RatePlanScopeError extends Error {}

/**
 * Confirms a rate plan belongs to `hotelId` before a write touches it (RATES-001).
 *
 * The rate-plan page's `load` already refuses another hotel's plan, but its actions take the
 * plan id straight from the URL and can be POSTed to directly, skipping `load`. Without this
 * check, an admin of hotel A could add price overrides or seasonal rates to hotel B's plan,
 * since pricing reads them by plan id.
 */
export async function assertRatePlanInHotel(hotelId: string, ratePlanId: string): Promise<void> {
	const [plan] = await db
		.select({ id: ratePlans.id })
		.from(ratePlans)
		.where(and(eq(ratePlans.id, ratePlanId), eq(ratePlans.hotelId, hotelId)))
		.limit(1);
	if (!plan) throw new RatePlanScopeError('Rate plan not found.');
}

/**
 * Confirms every room type / policy a rate plan is being pointed at belongs to `hotelId`
 * (RATES-003). Foreign keys only prove the row exists, not whose it is. Blank refs are
 * skipped — they mean "none".
 */
export async function assertPlanRefsInHotel(
	hotelId: string,
	refs: {
		roomTypeId?: string | null;
		cancellationPolicyId?: string | null;
		securityDepositPolicyId?: string | null;
	}
): Promise<void> {
	if (refs.roomTypeId) {
		const [row] = await db
			.select({ id: roomTypes.id })
			.from(roomTypes)
			.where(and(eq(roomTypes.id, refs.roomTypeId), eq(roomTypes.hotelId, hotelId)))
			.limit(1);
		if (!row) throw new RatePlanScopeError('Choose a room type from this hotel.');
	}
	if (refs.cancellationPolicyId) {
		const [row] = await db
			.select({ id: cancellationPolicies.id })
			.from(cancellationPolicies)
			.where(
				and(
					eq(cancellationPolicies.id, refs.cancellationPolicyId),
					eq(cancellationPolicies.hotelId, hotelId)
				)
			)
			.limit(1);
		if (!row) throw new RatePlanScopeError('Choose a cancellation policy from this hotel.');
	}
	if (refs.securityDepositPolicyId) {
		const [row] = await db
			.select({ id: securityDepositPolicies.id })
			.from(securityDepositPolicies)
			.where(
				and(
					eq(securityDepositPolicies.id, refs.securityDepositPolicyId),
					eq(securityDepositPolicies.hotelId, hotelId)
				)
			)
			.limit(1);
		if (!row) throw new RatePlanScopeError('Choose a security deposit policy from this hotel.');
	}
}

/**
 * Every distinct inclusion string already used across this hotel's rate plans,
 * case-insensitively deduped (first-seen casing wins) and sorted — the
 * suggestion list the inclusions tag-input autocompletes against, so the same
 * inclusion doesn't end up spelled several different ways across plans.
 */
export async function listDistinctInclusions(hotelId: string): Promise<string[]> {
	const rows = await db
		.select({ inclusions: ratePlans.inclusions })
		.from(ratePlans)
		.where(and(eq(ratePlans.hotelId, hotelId), isNull(ratePlans.deletedAt)));

	const seen = new Map<string, string>();
	for (const row of rows) {
		for (const item of row.inclusions) {
			const key = item.toLowerCase();
			if (!seen.has(key)) seen.set(key, item);
		}
	}
	return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
