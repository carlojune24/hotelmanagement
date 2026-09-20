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
