import type { CartStore } from '$lib/cart.svelte';

export function itemLabel(item: CartStore['items'][number]): string {
	return item.kind === 'room' ? item.roomTypeName : item.hallName;
}

export function itemDetail(item: CartStore['items'][number]): string {
	return item.kind === 'room'
		? `${item.ratePlanName} · ${item.checkIn} → ${item.checkOut}` +
				(item.roomCount > 1 ? ` · ${item.roomCount} rooms` : '')
		: `${item.eventType} · ${item.eventDate}, ${item.startTime}–${item.endTime}`;
}
