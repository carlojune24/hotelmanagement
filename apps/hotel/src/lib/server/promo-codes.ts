import { and, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { bookings, promoCodes, promoRedemptions, type PromoCode } from '$lib/server/db/schema/index';

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

/** A code's terms in words — "10% off" or "₱200.00 off" — or null when the code row is gone
 *  or has no usable terms. Shared by the staff folio and the guest-facing pages. */
export function describePromoTerms(
	code: {
		discountType: 'percentage' | 'fixed_amount' | null;
		discountBps: number | null;
		discountAmountCentavos: number | null;
	} | null
): string | null {
	if (!code) return null;
	if (code.discountType === 'percentage' && code.discountBps != null)
		return `${code.discountBps / 100}% off`;
	if (code.discountType === 'fixed_amount' && code.discountAmountCentavos != null)
		return `₱${(code.discountAmountCentavos / 100).toFixed(2)} off`;
	return null;
}

/** What the guest was told about a promo on their order. */
export interface OrderPromo {
	code: string;
	/** "10% off" / "₱200.00 off"; null if the code has since been deleted. */
	terms: string | null;
	/** Total taken off the whole order (sum of every room's share). */
	discountCentavos: number;
}

/** The promo code redeemed on an order, or null. One code per order (see checkout), so the
 *  code + terms come from any one redemption while the amount is the sum across its rooms. */
export async function getOrderPromo(orderId: string): Promise<OrderPromo | null> {
	const rows = await db
		.select({
			code: promoRedemptions.code,
			discountCentavos: promoRedemptions.discountCentavos,
			discountType: promoCodes.discountType,
			discountBps: promoCodes.discountBps,
			discountAmountCentavos: promoCodes.discountAmountCentavos
		})
		.from(promoRedemptions)
		.innerJoin(bookings, eq(bookings.id, promoRedemptions.bookingId))
		.leftJoin(promoCodes, eq(promoCodes.id, promoRedemptions.promoCodeId))
		.where(and(eq(bookings.orderId, orderId), isNull(promoRedemptions.voidedAt)));
	const total = rows.reduce((sum, r) => sum + r.discountCentavos, 0);
	if (rows.length === 0 || total <= 0) return null;
	return { code: rows[0]!.code, terms: describePromoTerms(rows[0]!), discountCentavos: total };
}
