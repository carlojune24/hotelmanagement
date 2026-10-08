/** Pure pricing and status rules for dining orders. No database, and safe to import from
 *  the browser (the POS shows live totals with the same maths the server re-checks).
 *  Money is integer centavos and menu prices are VAT-inclusive. */

/** VAT already inside a VAT-inclusive amount: `gross * rate / (10000 + rate)`. Same formula as
 *  `inputVatOf` in `lib/server/finance/calc.ts` (kept separate only so the browser can import it). */
export function vatPortion(grossCentavos: number, vatRateBps: number): number {
	if (vatRateBps <= 0) return 0;
	return Math.round((grossCentavos * vatRateBps) / (10_000 + vatRateBps));
}

export interface PricedLine {
	/** Sum of the chosen add-ons, per unit. */
	addonsCentavos: number;
	lineTotalCentavos: number;
	vatCentavos: number;
}

/** One order line: (price + add-ons) × quantity, with the VAT included in it. */
export function priceLine(args: {
	unitPriceCentavos: number;
	addonPricesCentavos: number[];
	quantity: number;
	taxable: boolean;
	vatRateBps: number;
}): PricedLine {
	const addonsCentavos = args.addonPricesCentavos.reduce((s, p) => s + p, 0);
	const lineTotalCentavos = (args.unitPriceCentavos + addonsCentavos) * args.quantity;
	return {
		addonsCentavos,
		lineTotalCentavos,
		vatCentavos: args.taxable ? vatPortion(lineTotalCentavos, args.vatRateBps) : 0
	};
}

export function sumLines(lines: PricedLine[]): { totalCentavos: number; vatCentavos: number } {
	return {
		totalCentavos: lines.reduce((s, l) => s + l.lineTotalCentavos, 0),
		vatCentavos: lines.reduce((s, l) => s + l.vatCentavos, 0)
	};
}

export interface AddonGroupRule {
	id: string;
	name: string;
	minChoices: number;
	maxChoices: number | null;
}

/** Checks one dish's add-on picks against the rules of the groups it offers. Returns a
 *  guest-readable problem, or null when the selection is fine. `chosenByGroup` maps a group id
 *  to how many of its add-ons were picked. */
export function checkAddonSelection(
	itemName: string,
	groups: AddonGroupRule[],
	chosenByGroup: Record<string, number>
): string | null {
	for (const g of groups) {
		const n = chosenByGroup[g.id] ?? 0;
		if (n < g.minChoices) {
			return g.minChoices === 1
				? `${itemName}: choose an option for "${g.name}".`
				: `${itemName}: choose at least ${g.minChoices} for "${g.name}".`;
		}
		if (g.maxChoices != null && n > g.maxChoices) {
			return `${itemName}: choose at most ${g.maxChoices} for "${g.name}".`;
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Status flow
// ---------------------------------------------------------------------------

/** `pending_payment` is an online order waiting for PayMongo to confirm; it is invisible to the
 *  kitchen and only the payment confirmation (or an expiry/cancel) moves it on. */
export type OrderStatus = 'pending_payment' | 'new' | 'accepted' | 'preparing' | 'ready' | 'served' | 'cancelled';

/** Where an order can go next. The kitchen may skip "accepted"; served and cancelled are final. */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
	pending_payment: ['new', 'cancelled'],
	new: ['accepted', 'preparing', 'cancelled'],
	accepted: ['preparing', 'cancelled'],
	preparing: ['ready', 'cancelled'],
	ready: ['served', 'cancelled'],
	served: [],
	cancelled: []
};

export const canMoveOrder = (from: string, to: string) =>
	(ORDER_TRANSITIONS[from as OrderStatus] ?? []).includes(to as OrderStatus);

/** The one forward step the board's primary button takes. */
export const NEXT_STEP: Partial<Record<OrderStatus, OrderStatus>> = {
	new: 'preparing',
	accepted: 'preparing',
	preparing: 'ready',
	ready: 'served'
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
	pending_payment: 'Awaiting payment',
	new: 'New',
	accepted: 'Accepted',
	preparing: 'Preparing',
	ready: 'Ready',
	served: 'Served',
	cancelled: 'Cancelled'
};

export const ORDER_TYPE_LABEL: Record<string, string> = {
	dine_in: 'Dine-in',
	takeaway: 'Takeaway',
	pre_order: 'Pre-order'
};
