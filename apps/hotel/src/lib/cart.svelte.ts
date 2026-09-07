import { browser } from '$app/environment';
import type { PriceBreakdown, HallPriceBreakdown } from '$lib/server/pricing';

export type CartItem =
	| {
			kind: 'room';
			id: string;
			roomTypeId: string;
			ratePlanId: string;
			roomTypeName: string;
			ratePlanName: string;
			checkIn: string;
			checkOut: string;
			occupancy: number;
			/** How many rooms of this type/plan — `price` is already scaled by this count
			 *  (see `$lib/pricing-utils`'s `scaleRoomPrice`), so cart totals don't need to know. */
			roomCount: number;
			price: PriceBreakdown;
	  }
	| {
			kind: 'hall';
			id: string;
			functionHallId: string;
			hallName: string;
			eventDate: string;
			startTime: string;
			endTime: string;
			eventType: string;
			guestCount: number;
			price: HallPriceBreakdown;
	  };

/**
 * The guest's pending selections before checkout — a room stay and/or a
 * function hall reservation, added from the storefront's "Reserve"/"Add to
 * invoice" actions and shown in the floating invoice. One instance lives per
 * page load, created in `book/+layout.svelte` and shared via Svelte context
 * (not a module-level singleton — SSR reuses the process across concurrent
 * guests, so module `$state` would leak between them). Persisted to
 * `sessionStorage` so it survives a reload within the same tab/session, but
 * never touches storage during SSR.
 */
export class CartStore {
	items = $state<CartItem[]>([]);
	#storageKey: string;

	constructor(hotelSlug: string) {
		this.#storageKey = `mmhotel:cart:${hotelSlug}`;
		if (browser) {
			try {
				const raw = sessionStorage.getItem(this.#storageKey);
				if (raw) this.items = JSON.parse(raw);
			} catch {
				// Corrupt or stale-shape data — start empty rather than throw.
			}
		}
	}

	#persist() {
		if (browser) {
			try {
				sessionStorage.setItem(this.#storageKey, JSON.stringify(this.items));
			} catch {
				// Storage full/unavailable (private browsing, quota) — the in-memory
				// cart still works for this page load, just won't survive a reload.
			}
		}
	}

	addRoom(item: Omit<Extract<CartItem, { kind: 'room' }>, 'id' | 'kind'>) {
		this.items.push({ kind: 'room', id: crypto.randomUUID(), ...item });
		this.#persist();
	}

	addHall(item: Omit<Extract<CartItem, { kind: 'hall' }>, 'id' | 'kind'>) {
		this.items.push({ kind: 'hall', id: crypto.randomUUID(), ...item });
		this.#persist();
	}

	remove(id: string) {
		this.items = this.items.filter((i) => i.id !== id);
		this.#persist();
	}

	clear() {
		this.items = [];
		this.#persist();
	}

	get subtotalCentavos() {
		return this.items.reduce((sum, i) => sum + i.price.subtotalCentavos, 0);
	}
	get feesCentavos() {
		return this.items.reduce(
			(sum, i) => sum + i.price.fees.reduce((a, f) => a + f.amountCentavos, 0),
			0
		);
	}
	get vatCentavos() {
		return this.items.reduce((sum, i) => sum + i.price.vatCentavos, 0);
	}
	get totalCentavos() {
		return this.items.reduce((sum, i) => sum + i.price.totalCentavos, 0);
	}
}
