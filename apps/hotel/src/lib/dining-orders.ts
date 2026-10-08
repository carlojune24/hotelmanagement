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
 *  kitchen and only the payment confirmation (or an expiry/cancel) moves it on.
 *  `pending_acceptance` is a table-QR order waiting for staff to accept or decline it. */
export type OrderStatus = 'pending_payment' | 'pending_acceptance' | 'new' | 'accepted' | 'preparing' | 'ready' | 'served' | 'cancelled';

/** Where an order can go next. The kitchen may skip "accepted"; served and cancelled are final. */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
	pending_payment: ['new', 'cancelled'],
	pending_acceptance: ['new', 'cancelled'],
	new: ['accepted', 'preparing', 'cancelled'],
	accepted: ['preparing', 'cancelled'],
	preparing: ['ready', 'cancelled'],
	ready: ['served', 'cancelled'],
	served: [],
	cancelled: []
};

export const canMoveOrder = (from: string, to: string) =>
	(ORDER_TRANSITIONS[from as OrderStatus] ?? []).includes(to as OrderStatus);

/** Steps only the kitchen takes, on the Kitchen tab. The Orders tab offers none of these. */
export const KITCHEN_STEPS: readonly OrderStatus[] = ['accepted', 'preparing', 'ready'];

/** The one forward step the board's primary button takes (the kitchen's steps are taken on the Kitchen tab). */
export const NEXT_STEP: Partial<Record<OrderStatus, OrderStatus>> = {
	new: 'preparing',
	accepted: 'preparing',
	preparing: 'ready',
	ready: 'served'
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
	pending_payment: 'Awaiting payment',
	pending_acceptance: 'Awaiting staff',
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

// ---------------------------------------------------------------------------
// Kitchen timing and per-station cooking
// ---------------------------------------------------------------------------

/** How long a ticket may wait before it is "late" when its station sets no target. */
export const DEFAULT_TARGET_MINUTES = 20;

export type WaitLevel = 'ok' | 'slow' | 'late';

/** `late` at the station's target, `slow` at half of it. */
export function waitLevel(minutes: number, targetMinutes?: number | null): WaitLevel {
	const late = targetMinutes && targetMinutes > 0 ? targetMinutes : DEFAULT_TARGET_MINUTES;
	const slow = Math.max(1, Math.floor(late / 2));
	if (minutes >= late) return 'late';
	return minutes >= slow ? 'slow' : 'ok';
}

/** `34 min`, then `1h 05m` once it passes the hour. */
export function formatWait(minutes: number): string {
	const m = Math.max(0, Math.floor(minutes));
	if (m < 60) return `${m} min`;
	return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export type StationState = 'waiting' | 'cooking' | 'ready';

export interface StationLine {
	stationName: string | null;
	startedAt: Date | null;
	readyAt: Date | null;
}

export interface StationGroup<T> {
	/** The station name, or '' for dishes with no station. */
	key: string;
	label: string;
	items: T[];
	state: StationState;
	startedAt: Date | null;
	readyAt: Date | null;
}

/** An order's lines grouped by the station that cooks them, in first-seen order. A station is
 *  ready when every one of its lines is, and cooking once any line has started. */
export function groupByStation<T extends StationLine>(items: T[]): StationGroup<T>[] {
	const byKey = new Map<string, T[]>();
	for (const it of items) {
		const key = it.stationName ?? '';
		byKey.set(key, [...(byKey.get(key) ?? []), it]);
	}
	const hasNamed = [...byKey.keys()].some((k) => k !== '');
	return [...byKey.entries()].map(([key, list]) => {
		const allReady = list.every((i) => i.readyAt);
		const anyStarted = list.some((i) => i.startedAt || i.readyAt);
		const starts = list.map((i) => i.startedAt ?? i.readyAt).filter((d): d is Date => !!d);
		const readies = list.map((i) => i.readyAt).filter((d): d is Date => !!d);
		return {
			key,
			label: key || (hasNamed ? 'Unassigned' : 'Kitchen'),
			items: list,
			state: allReady ? 'ready' : anyStarted ? 'cooking' : 'waiting',
			startedAt: starts.length ? new Date(Math.min(...starts.map((d) => new Date(d).getTime()))) : null,
			readyAt: allReady && readies.length ? new Date(Math.max(...readies.map((d) => new Date(d).getTime()))) : null
		};
	});
}

/** What the order as a whole is doing, derived from its stations. */
export function orderStateFromStations(groups: { state: StationState }[]): 'new' | 'preparing' | 'ready' {
	if (groups.length > 0 && groups.every((g) => g.state === 'ready')) return 'ready';
	return groups.some((g) => g.state !== 'waiting') ? 'preparing' : 'new';
}
