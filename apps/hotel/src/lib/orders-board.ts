import { waitLevel } from './dining-orders';

/**
 * Pure model behind the Dining → Orders board: which section an order sits in, how each section
 * is ordered, and the numbers on the summary tiles. No DB, no clock of its own (`nowMs` is passed in).
 */

export interface BoardOrder {
	id: string;
	code: string;
	status: string;
	paymentStatus: string;
	orderType: string;
	tableLabel: string | null;
	guestName: string | null;
	createdAt: string;
	readyAt: string | null;
	servedAt: string | null;
	totalCentavos: number;
	items: { name: string; quantity: number }[];
}

export interface BoardGroups<T extends BoardOrder> {
	/** Cooked, waiting to be taken to the table: longest waiting first. */
	ready: T[];
	/** With the kitchen: late first, then oldest. */
	preparing: T[];
	/** Placed, not started: oldest first. */
	fresh: T[];
	/** Served today: most recently served first. */
	served: T[];
}

export interface BoardSummary {
	ready: number;
	longestReadyMinutes: number;
	preparing: number;
	late: number;
	fresh: number;
	unpaid: number;
	unpaidCentavos: number;
}

const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : NaN);

/** Whole minutes between an ISO timestamp and `nowMs`, never negative. */
export function minutesSince(iso: string | null, nowMs: number): number {
	const t = ms(iso);
	return Number.isNaN(t) ? 0 : Math.max(0, Math.floor((nowMs - t) / 60_000));
}

/** How long a ready order has been waiting at the pass (falls back to its age). */
export const readyMinutes = (o: Pick<BoardOrder, 'readyAt' | 'createdAt'>, nowMs: number) =>
	minutesSince(o.readyAt ?? o.createdAt, nowMs);

/** Owes money and is on the board proper (a table-QR order not yet accepted is not "to pay" yet). */
export const isUnpaid = (o: Pick<BoardOrder, 'paymentStatus' | 'status'>) =>
	o.paymentStatus === 'unpaid' && o.status !== 'pending_acceptance';

/** Search over table, order code, guest and dish names; every word must match somewhere. */
export function matchesSearch(o: BoardOrder, query: string): boolean {
	const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) return true;
	const hay = [
		o.code,
		o.tableLabel ? `table ${o.tableLabel}` : '',
		o.guestName ?? '',
		...o.items.map((i) => i.name)
	]
		.join(' ')
		.toLowerCase();
	return words.every((w) => hay.includes(w));
}

export function boardGroups<T extends BoardOrder>(
	orders: T[],
	nowMs: number,
	opts: { query?: string; unpaidOnly?: boolean } = {}
): BoardGroups<T> {
	const visible = orders.filter(
		(o) =>
			o.status !== 'pending_acceptance' &&
			o.status !== 'cancelled' &&
			matchesSearch(o, opts.query ?? '') &&
			(!opts.unpaidOnly || isUnpaid(o))
	);

	const age = (o: T) => minutesSince(o.createdAt, nowMs);
	const isLate = (o: T) => waitLevel(age(o)) === 'late';

	return {
		ready: visible.filter((o) => o.status === 'ready').sort((a, b) => readyMinutes(b, nowMs) - readyMinutes(a, nowMs)),
		preparing: visible
			.filter((o) => o.status === 'preparing')
			.sort((a, b) => Number(isLate(b)) - Number(isLate(a)) || age(b) - age(a)),
		fresh: visible.filter((o) => o.status === 'new' || o.status === 'accepted').sort((a, b) => age(b) - age(a)),
		served: visible.filter((o) => o.status === 'served').sort((a, b) => (ms(b.servedAt) || 0) - (ms(a.servedAt) || 0))
	};
}

/** Whole-board numbers for the four tiles (not narrowed by search, so the tiles stay the true picture). */
export function boardSummary(orders: BoardOrder[], nowMs: number): BoardSummary {
	const live = orders.filter((o) => o.status !== 'pending_acceptance' && o.status !== 'cancelled');
	const ready = live.filter((o) => o.status === 'ready');
	const preparing = live.filter((o) => o.status === 'preparing');
	const unpaid = live.filter(isUnpaid);
	return {
		ready: ready.length,
		longestReadyMinutes: ready.reduce((m, o) => Math.max(m, readyMinutes(o, nowMs)), 0),
		preparing: preparing.length,
		late: preparing.filter((o) => waitLevel(minutesSince(o.createdAt, nowMs)) === 'late').length,
		fresh: live.filter((o) => o.status === 'new' || o.status === 'accepted').length,
		unpaid: unpaid.length,
		unpaidCentavos: unpaid.reduce((s, o) => s + o.totalCentavos, 0)
	};
}

/** The short label on a table chip: `Table T5` → `T5`. Null when the order has no table. */
export function tableChip(label: string | null): string | null {
	const t = (label ?? '').replace(/^table\s+/i, '').trim();
	return t ? t.slice(0, 4) : null;
}

const METHOD: Record<string, string> = { paymongo: 'Online', cash: 'Cash', card: 'Card', gcash: 'GCash', maya: 'Maya', room_charge: 'Room' };

/** `Unpaid`, `Room 204`, `Paid · Cash` (or just `Paid` when `withMethod` is off). */
export function paymentLabel(
	o: { paymentStatus: string; paymentMethod: string | null; roomLabel: string | null },
	withMethod = true
): string {
	if (o.paymentStatus === 'unpaid') return 'Unpaid';
	if (o.paymentStatus === 'room_charged') return `Room ${o.roomLabel ?? ''}`.trim();
	const m = o.paymentMethod ? (METHOD[o.paymentMethod] ?? o.paymentMethod) : '';
	return withMethod && m ? `Paid · ${m}` : 'Paid';
}

/** `1× Layua sa baboy, 2× Pray Rays` for one-line summaries. */
export const itemsLine = (items: { name: string; quantity: number }[]) =>
	items.map((i) => `${i.quantity}× ${i.name}`).join(', ');
