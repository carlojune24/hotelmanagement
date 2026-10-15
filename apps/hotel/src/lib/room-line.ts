import type { PriceBreakdown } from '$lib/server/pricing';
import type { AvailableRatePlan, AvailableRoomType, CancellationTerms } from '$lib/server/availability';
import type { CartItem } from '$lib/cart.svelte';
import { addFlatFeeCentavos, scaleRoomPrice } from '$lib/pricing-utils';

/**
 * Client-safe helpers for turning one searched room type + rate plan into a cart line. Shared by the
 * wizard's Rooms & Rates step and the homepage's live-availability cards so the price a guest sees and
 * the line that lands in the cart are built by the same arithmetic. `createOrder` still re-prices every
 * line on the server; this is display and cart state only.
 */

/** The line price for `count` rooms of a plan, including the per-line extra-bed fee when the party needs beds. */
export function roomLinePrice(
	roomType: Pick<AvailableRoomType, 'extraBedsNeeded'>,
	plan: Pick<AvailableRatePlan, 'price' | 'extraBedFeeCentavos'>,
	count: number,
	vatRateBps: number
): PriceBreakdown {
	let price = scaleRoomPrice(plan.price, count);
	if (roomType.extraBedsNeeded > 0 && plan.extraBedFeeCentavos) {
		price = addFlatFeeCentavos(
			price,
			`Extra bed × ${roomType.extraBedsNeeded}`,
			roomType.extraBedsNeeded * plan.extraBedFeeCentavos,
			vatRateBps
		);
	}
	return price;
}

export function roomCartItem(args: {
	roomType: AvailableRoomType;
	plan: AvailableRatePlan;
	checkIn: string;
	checkOut: string;
	occupancy: number;
	roomCount: number;
	vatRateBps: number;
}): Omit<Extract<CartItem, { kind: 'room' }>, 'id' | 'kind'> {
	const { roomType, plan } = args;
	return {
		roomTypeId: roomType.id,
		ratePlanId: plan.id,
		roomTypeName: roomType.name,
		ratePlanName: plan.name,
		checkIn: args.checkIn,
		checkOut: args.checkOut,
		occupancy: args.occupancy,
		roomCount: args.roomCount,
		price: roomLinePrice(roomType, plan, args.roomCount, args.vatRateBps),
		downpaymentBps: plan.cancellation?.downpaymentBps ?? null,
		securityDepositCentavos: plan.securityDepositCentavos
	};
}

export function cancellationLabel(c: CancellationTerms | null): { text: string; free: boolean } {
	if (c && c.freeCancelHours != null) {
		const days = Math.floor(c.freeCancelHours / 24);
		const text =
			c.freeCancelHours % 24 === 0 && days >= 1
				? `Free cancellation up to ${days} day${days === 1 ? '' : 's'} before check-in`
				: `Free cancellation up to ${c.freeCancelHours}h before check-in`;
		return { text, free: true };
	}
	return { text: 'Non-refundable', free: false };
}

/** "city_view" -> "City view": stored option values read as words. */
export function humanize(value: string): string {
	const t = value.replace(/[_-]+/g, " ").trim();
	return t.charAt(0).toUpperCase() + t.slice(1);
}
