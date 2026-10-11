/** Pure helpers for the Dining Messages inbox. No database; safe in the browser. */

/**
 * What a conversation is about. Messages always belong to one dining order, but staff think in terms of
 * where the guest is: an online pickup, an online delivery, a pre-order for a table reservation, a table
 * QR order, or an order placed at the venue.
 */
export type ThreadKind = 'delivery' | 'pickup' | 'reservation' | 'table_qr' | 'venue';

export const THREAD_KIND_LABEL: Record<ThreadKind, string> = {
	delivery: 'Online delivery',
	pickup: 'Online pickup',
	reservation: 'Table reservation',
	table_qr: 'Table QR order',
	venue: 'Order at the venue'
};

export function threadKind(o: {
	source: string;
	orderType: string;
	fulfilment: string | null;
	reservationId: string | null;
}): ThreadKind {
	if (o.orderType === 'pre_order' || o.reservationId) return 'reservation';
	if (o.source === 'online') return o.fulfilment === 'delivery' ? 'delivery' : 'pickup';
	if (o.source === 'qr') return 'table_qr';
	return 'venue';
}

export const THREAD_FILTERS = ['all', 'unread', 'pickup', 'delivery', 'reservation'] as const;
export type ThreadFilter = (typeof THREAD_FILTERS)[number];

export function parseThreadFilter(v: string | null | undefined): ThreadFilter {
	return (THREAD_FILTERS as readonly string[]).includes(v ?? '') ? (v as ThreadFilter) : 'all';
}

export function matchesFilter(t: { kind: ThreadKind; unread: number }, filter: ThreadFilter): boolean {
	if (filter === 'all') return true;
	if (filter === 'unread') return t.unread > 0;
	return t.kind === filter;
}

/** Case-insensitive match on the guest, the order code, the reservation code, the phone or the last message. */
export function matchesQuery(
	t: { guestName: string | null; guestPhone: string | null; code: string; reservation: { code: string } | null; lastBody: string },
	query: string
): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	return [t.guestName, t.guestPhone, t.code, t.reservation?.code, t.lastBody].some((v) => (v ?? '').toLowerCase().includes(q));
}

/** `just now`, `5 min ago`, `3 h ago`, or a short date. */
export function relativeTime(iso: string, nowMs: number, timezone?: string): string {
	const diff = Math.max(0, nowMs - new Date(iso).getTime());
	const min = Math.floor(diff / 60_000);
	if (min < 1) return 'just now';
	if (min < 60) return `${min} min ago`;
	const h = Math.floor(min / 60);
	if (h < 24) return `${h} h ago`;
	return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', timeZone: timezone }).format(new Date(iso));
}
