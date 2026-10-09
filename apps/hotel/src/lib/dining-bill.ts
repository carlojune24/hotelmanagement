/**
 * Pure maths for the printed guest bill: a plain, non-fiscal statement of what a table ordered.
 * No DB here — `server/dining-bill.ts` loads the rows and hands them to these functions.
 */

export interface BillOrderInput {
	id: string;
	code: string;
	status: string;
	paymentStatus: string;
	totalCentavos: number;
	vatCentavos: number;
	items: {
		name: string;
		quantity: number;
		/** Per unit, add-ons not included. */
		unitPriceCentavos: number;
		/** Per unit. */
		addonsCentavos: number;
		lineTotalCentavos: number;
		addons: string[];
	}[];
}

export interface BillLine {
	orderCode: string;
	description: string;
	quantity: number;
	/** Per unit, add-ons included. */
	unitPriceCentavos: number;
	lineTotalCentavos: number;
}

export interface BillTotals {
	lines: BillLine[];
	/** How many orders contributed lines (the print groups by order only when this is above 1). */
	orderCount: number;
	totalCentavos: number;
	/** VAT already inside the total (menu prices are VAT-inclusive). */
	vatCentavos: number;
	paidCentavos: number;
	dueCentavos: number;
}

/** Orders that belong on a bill: same rule as the Floor's check total (`summarizeCheck`). */
export const isBillable = (o: { status: string }) =>
	o.status !== 'cancelled' && o.status !== 'pending_acceptance' && o.status !== 'pending_payment';

/** A paid or room-charged order no longer counts towards what is still due. */
export const isSettled = (o: { paymentStatus: string }) => o.paymentStatus === 'paid' || o.paymentStatus === 'room_charged';

/** `Pad Thai (extra egg, no peanuts)` */
export const describeItem = (name: string, addons: string[]) => (addons.length > 0 ? `${name} (${addons.join(', ')})` : name);

export function buildBill(orders: BillOrderInput[]): BillTotals {
	const live = orders.filter(isBillable);
	const lines: BillLine[] = live.flatMap((o) =>
		o.items.map((i) => ({
			orderCode: o.code,
			description: describeItem(i.name, i.addons),
			quantity: i.quantity,
			unitPriceCentavos: i.unitPriceCentavos + i.addonsCentavos,
			lineTotalCentavos: i.lineTotalCentavos
		}))
	);
	const total = live.reduce((s, o) => s + o.totalCentavos, 0);
	const paid = live.filter(isSettled).reduce((s, o) => s + o.totalCentavos, 0);
	return {
		lines,
		orderCount: live.filter((o) => o.items.length > 0).length,
		totalCentavos: total,
		vatCentavos: live.reduce((s, o) => s + o.vatCentavos, 0),
		paidCentavos: paid,
		dueCentavos: Math.max(0, total - paid)
	};
}
