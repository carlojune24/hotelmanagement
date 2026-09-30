import { and, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { promoCodes, type PromoCode } from '$lib/server/db/schema/index';

/** A real code is at most this long — capped before it touches anything else (query params,
 *  form fields, DB lookups) so a much longer guess is never worth carrying around uncapped. */
export const MAX_PROMO_CODE_LENGTH = 40;

/** Codes are stored upper-trimmed so uniqueness and matching are a plain equality check, no
 *  functional index or case-insensitive collation needed. */
export function normalizePromoCode(code: string): string {
	return code.trim().toUpperCase().slice(0, MAX_PROMO_CODE_LENGTH);
}

/** The active, in-window promo code matching `rawCode` for this hotel, or null if the code
 *  doesn't exist, belongs to another hotel, is inactive/deleted, or is outside its redemption
 *  window. Never distinguishes *why* a code failed to the caller — same posture as the old
 *  gate model's guessing defense, just without the guess-throttling (a wrong guess here only
 *  ever fails to discount, it can never reveal hidden inventory). */
export async function findRedeemablePromoCode(
	hotelId: string,
	rawCode: string,
	now: Date = new Date()
): Promise<PromoCode | null> {
	const code = normalizePromoCode(rawCode);
	if (!code) return null;

	const [row] = await db
		.select()
		.from(promoCodes)
		.where(
			and(
				eq(promoCodes.hotelId, hotelId),
				eq(promoCodes.code, code),
				eq(promoCodes.isActive, true),
				isNull(promoCodes.deletedAt),
				or(isNull(promoCodes.validFrom), lte(promoCodes.validFrom, now)),
				or(isNull(promoCodes.validUntil), gte(promoCodes.validUntil, now))
			)
		)
		.limit(1);
	return row ?? null;
}
