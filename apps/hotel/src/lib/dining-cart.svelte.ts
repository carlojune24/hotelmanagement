import { getContext, setContext } from 'svelte';
import {
	addLine,
	cartTotals,
	changeQuantity,
	removeLine,
	restoreLines,
	setRemarks,
	toStored,
	type CartAddon,
	type CartItem,
	type CartLine,
	type RestoreMenu
} from './dining-cart';

const CONTEXT_KEY = Symbol('table-cart');

/**
 * The reactive cart for one table. It lives in the table layout, so it stays put while the guest goes
 * between the menu and My orders, and it is mirrored to `sessionStorage` (per table code) so a reload
 * or an accidental swipe-back doesn't lose it. All the rules are in `dining-cart.ts`.
 */
export class TableCart {
	lines = $state<CartLine[]>([]);
	guestName = $state('');
	note = $state('');
	totals = $derived(cartTotals(this.lines));

	#seq = 0;
	#storageKey: string;
	/** Stored lines waiting for the menu, so they can be checked against today's dishes and prices. */
	#pending: unknown = null;
	#loaded = false;

	constructor(token: string) {
		this.#storageKey = `dining-cart:${token}`;
	}

	add(item: CartItem, addons: CartAddon[], quantity: number, remarks: string) {
		this.lines = addLine(this.lines, item, addons, quantity, remarks, ++this.#seq);
	}
	change(key: number, delta: number) {
		this.lines = changeQuantity(this.lines, key, delta);
	}
	remove(key: number) {
		this.lines = removeLine(this.lines, key);
	}
	setRemarks(key: number, remarks: string) {
		this.lines = setRemarks(this.lines, key, remarks);
	}
	clear() {
		this.lines = [];
		this.note = '';
	}

	/** Reads what an earlier visit stored. Call once in the browser; storage can be blocked, which is fine. */
	load() {
		try {
			const raw = sessionStorage.getItem(this.#storageKey);
			this.#pending = raw ? JSON.parse(raw) : null;
		} catch {
			this.#pending = null;
		}
		this.#loaded = true;
	}

	/** Puts the stored lines back, against the menu that is on screen now. Does nothing the second time. */
	hydrate(menu: RestoreMenu) {
		if (this.#pending === null) return;
		const restored = restoreLines(this.#pending, menu, this.#seq + 1);
		this.#pending = null;
		this.#seq += restored.length;
		if (restored.length > 0) this.lines = [...restored, ...this.lines];
	}

	/** Writes the cart to storage. Safe to call from an effect: it reads `lines`, so it re-runs on every change. */
	save() {
		const lines = this.lines;
		if (!this.#loaded || this.#pending !== null) return; // never overwrite what we have not read back yet
		try {
			if (lines.length === 0) sessionStorage.removeItem(this.#storageKey);
			else sessionStorage.setItem(this.#storageKey, JSON.stringify(toStored(lines)));
		} catch {
			/* private mode or blocked storage: the cart just won't survive a reload */
		}
	}
}

export const setTableCart = (token: string) => {
	const cart = new TableCart(token);
	setContext(CONTEXT_KEY, cart);
	return cart;
};
export const getTableCart = () => getContext<TableCart>(CONTEXT_KEY);
