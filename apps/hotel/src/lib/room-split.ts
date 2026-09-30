/** A cart line for "N rooms of one type" becomes N bookings — one per room — so every room has its own
 *  folio, security deposit and charges. This divides the line's price, guests and extra beds across
 *  the rooms in whole centavos / whole people so the parts add up exactly to the line. */

/** Splits `total` into `n` integer parts differing by at most 1; the first `total % n` get the extra. */
export function splitInteger(total: number, n: number): number[] {
	if (n <= 0) return [];
	const base = Math.floor(total / n);
	const extra = total - base * n;
	return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Splits `total` (an integer, e.g. a promo discount in centavos) across `weights`
 *  proportionally, largest-remainder method — parts sum back to `total` exactly, unlike a
 *  naive `Math.round` per share which can be off by a centavo or two. Weights that are all
 *  zero (nothing eligible) get an all-zero split rather than dividing by zero. */
export function splitProportional(total: number, weights: number[]): number[] {
	const sumWeights = weights.reduce((a, b) => a + b, 0);
	if (sumWeights <= 0) return weights.map(() => 0);
	const raw = weights.map((w) => (total * w) / sumWeights);
	const floors = raw.map(Math.floor);
	let remainder = total - floors.reduce((a, b) => a + b, 0);
	const byFraction = raw
		.map((r, i) => ({ i, frac: r - floors[i]! }))
		.sort((a, b) => b.frac - a.frac);
	const result = [...floors];
	for (let k = 0; k < remainder && k < byFraction.length; k++) {
		result[byFraction[k]!.i]! += 1;
	}
	return result;
}

export interface LinePrice {
	subtotalCentavos: number;
	/** Sum of the line's fee amounts. */
	feesCentavos: number;
	vatCentavos: number;
	totalCentavos: number;
}

export interface RoomShare {
	subtotalCentavos: number;
	feesCentavos: number;
	vatCentavos: number;
	totalCentavos: number;
	occupancy: number;
	extraBeds: number;
}

export function splitRoomLine(
	price: LinePrice,
	occupancy: number,
	extraBeds: number,
	roomCount: number
): RoomShare[] {
	const sub = splitInteger(price.subtotalCentavos, roomCount);
	const fees = splitInteger(price.feesCentavos, roomCount);
	const vat = splitInteger(price.vatCentavos, roomCount);
	const total = splitInteger(price.totalCentavos, roomCount);
	// `occupancy` is the party's total across all the rooms; every room keeps at least one guest.
	const occ = splitInteger(Math.max(occupancy, roomCount), roomCount);
	const beds = splitInteger(extraBeds, roomCount);
	return Array.from({ length: roomCount }, (_, i) => ({
		subtotalCentavos: sub[i]!,
		feesCentavos: fees[i]!,
		vatCentavos: vat[i]!,
		totalCentavos: total[i]!,
		occupancy: occ[i]!,
		extraBeds: beds[i]!
	}));
}
