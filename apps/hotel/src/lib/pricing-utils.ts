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
