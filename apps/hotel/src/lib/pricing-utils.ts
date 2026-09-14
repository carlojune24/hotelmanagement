import type { PriceBreakdown } from '$lib/server/pricing';

/**
 * Client-safe pricing helpers — `$lib/server/pricing.ts` can't be imported at runtime from a
 * `.svelte` file (same server/client boundary documented for `$lib/amenity-categories.ts`), so
 * the one bit of arithmetic every room-count call site needs lives here instead.
 */

/** Upper bound on how many rooms of one type/rate plan a guest can request in one search line. */
export const MAX_ROOMS_PER_LINE = 8;

/**
 * Scales an already-fully-computed per-room `PriceBreakdown` by a room count. This is the only
 * place `× roomCount` arithmetic happens — called identically from the storefront's display code
 * and from `createOrder`'s server-side re-pricing, so a displayed price and the amount actually
 * charged can never drift apart.
 *
 * `nights` (the per-night rate schedule) is left unscaled — it's a rate reference, not an amount
 * owed, so multiplying it would misrepresent the nightly rate.
 */
export function scaleRoomPrice(perRoom: PriceBreakdown, roomCount: number): PriceBreakdown {
	if (roomCount < 1) throw new Error('roomCount must be at least 1');
	return {
		nights: perRoom.nights,
		subtotalCentavos: perRoom.subtotalCentavos * roomCount,
		fees: perRoom.fees.map((f) => ({ name: f.name, amountCentavos: f.amountCentavos * roomCount })),
		vatCentavos: perRoom.vatCentavos * roomCount,
		totalCentavos: perRoom.totalCentavos * roomCount
	};
}

/**
 * Adds one more flat fee (+ its own VAT share) on top of an already-computed breakdown —
 * for a charge that's per *line*, not per room, so it must be added after `scaleRoomPrice`
 * rather than baked into the per-room price and multiplied along with everything else.
 * The extra-bed fee (`ratePlans.extraBedFeeCentavos` × however many beds the whole line
 * needs, from `$lib/occupancy.ts`'s solver) is the first user of this; kept generic since
 * nothing about it is extra-bed-specific.
 */
export function addFlatFeeCentavos(
	breakdown: PriceBreakdown,
	name: string,
	amountCentavos: number,
	vatRateBps: number
): PriceBreakdown {
	if (amountCentavos <= 0) return breakdown;
	const feeVatCentavos = Math.round((amountCentavos * vatRateBps) / 10000);
	return {
		nights: breakdown.nights,
		subtotalCentavos: breakdown.subtotalCentavos,
		fees: [...breakdown.fees, { name, amountCentavos }],
		vatCentavos: breakdown.vatCentavos + feeVatCentavos,
		totalCentavos: breakdown.totalCentavos + amountCentavos + feeVatCentavos
	};
}
