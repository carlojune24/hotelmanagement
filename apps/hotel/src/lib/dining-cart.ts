import { priceLine, sumLines } from './dining-orders';

/**
 * The guest's cart at a table: pure functions over plain arrays, so the rules (merging, limits, totals,
 * what survives a reload) are testable without a browser. The reactive wrapper is `dining-cart.svelte.ts`.
 */

export const MAX_QUANTITY = 50;

export interface CartItem {
	id: string;
	name: string;
	priceCentavos: number;
	/** The dish's photo, shown in the cart. */
	imageUrl?: string | null;
}
export interface CartAddon {
	id: string;
	name: string;
	priceCentavos: number;
}
export interface CartLine {
	key: number;
	item: CartItem;
	addons: CartAddon[];
	quantity: number;
	remarks: string;
}

const clamp = (q: number) => Math.max(1, Math.min(MAX_QUANTITY, Math.floor(q) || 1));

/** Two lines are the same order line when dish, add-ons and kitchen note all match. */
export const addonSignature = (addons: { id: string }[]) =>
	addons
		.map((a) => a.id)
		.sort()
		.join(',');

const sameLine = (l: CartLine, item: { id: string }, addons: CartAddon[], remarks: string) =>
	l.item.id === item.id && addonSignature(l.addons) === addonSignature(addons) && l.remarks === remarks;

/** Adds a dish; merges into an identical line (capped at 50) instead of listing it twice. */
export function addLine(lines: CartLine[], item: CartItem, addons: CartAddon[], quantity: number, remarks: string, key: number): CartLine[] {
	const note = remarks.trim();
	const existing = lines.find((l) => sameLine(l, item, addons, note));
	if (existing) return lines.map((l) => (l === existing ? { ...l, quantity: clamp(l.quantity + quantity) } : l));
	return [...lines, { key, item: { id: item.id, name: item.name, priceCentavos: item.priceCentavos, imageUrl: item.imageUrl ?? null }, addons, quantity: clamp(quantity), remarks: note }];
}

/** +1 / −1 on a line; going below 1 removes it, going above 50 stops at 50. */
export function changeQuantity(lines: CartLine[], key: number, delta: number): CartLine[] {
	return lines.flatMap((l) => {
		if (l.key !== key) return [l];
		const next = l.quantity + delta;
		return next < 1 ? [] : [{ ...l, quantity: Math.min(MAX_QUANTITY, next) }];
	});
}

/** Edits a line's kitchen note in place (lines are not re-merged while someone is typing). */
export const setRemarks = (lines: CartLine[], key: number, remarks: string): CartLine[] =>
	lines.map((l) => (l.key === key ? { ...l, remarks: remarks.slice(0, 300) } : l));

export const removeLine = (lines: CartLine[], key: number) => lines.filter((l) => l.key !== key);

/** The plain version of a dish (no add-ons, no note), if it is already in the cart: what the inline − / + on a dish row edits. */
export const findPlainLine = (lines: CartLine[], itemId: string) =>
	lines.find((l) => l.item.id === itemId && l.addons.length === 0 && l.remarks === '');

/** How many of a dish are in the cart across all its variants. */
export const quantityOf = (lines: CartLine[], itemId: string) => lines.filter((l) => l.item.id === itemId).reduce((n, l) => n + l.quantity, 0);

export function cartTotals(lines: CartLine[]) {
	const priced = lines.map((l) =>
		priceLine({ unitPriceCentavos: l.item.priceCentavos, addonPricesCentavos: l.addons.map((a) => a.priceCentavos), quantity: l.quantity, taxable: true, vatRateBps: 0 })
	);
	return {
		priced,
		itemCount: lines.reduce((n, l) => n + l.quantity, 0),
		totalCentavos: sumLines(priced).totalCentavos
	};
}

// ---- surviving a reload ---------------------------------------------------------------------
// Only ids and choices are stored, never prices or names: the menu can change while a guest is deciding.

export interface StoredLine {
	itemId: string;
	addonIds: string[];
	quantity: number;
	remarks: string;
}
export const toStored = (lines: CartLine[]): StoredLine[] =>
	lines.map((l) => ({ itemId: l.item.id, addonIds: l.addons.map((a) => a.id), quantity: l.quantity, remarks: l.remarks }));

export interface RestoreMenu {
	items: { id: string; name: string; priceCentavos: number; imageUrl?: string | null; isAvailable: boolean; addonGroupIds: string[] }[];
	groups: { id: string; addons: { id: string; name: string; priceCentavos: number; isAvailable: boolean }[] }[];
}

/**
 * Turns stored lines back into cart lines against today's menu. A dish that is gone or sold out, or an
 * add-on that is no longer offered for it, drops that line, so a guest can never send a stale order.
 */
export function restoreLines(stored: unknown, menu: RestoreMenu, firstKey = 1): CartLine[] {
	if (!Array.isArray(stored)) return [];
	const out: CartLine[] = [];
	let key = firstKey;
	for (const raw of stored.slice(0, 40)) {
		if (!raw || typeof raw !== 'object') continue;
		const s = raw as Partial<StoredLine>;
		const item = menu.items.find((i) => i.id === s.itemId);
		if (!item || !item.isAvailable) continue;
		const offered = menu.groups.filter((g) => item.addonGroupIds.includes(g.id)).flatMap((g) => g.addons);
		const ids = Array.isArray(s.addonIds) ? s.addonIds.filter((x): x is string => typeof x === 'string') : [];
		const addons = ids.map((id) => offered.find((a) => a.id === id));
		if (addons.some((a) => !a || !a.isAvailable)) continue;
		const remarks = typeof s.remarks === 'string' ? s.remarks.slice(0, 300) : '';
		const merged = addLine(out, item, addons as CartAddon[], clamp(Number(s.quantity)), remarks, key);
		key += 1;
		out.splice(0, out.length, ...merged);
	}
	return out;
}
