/** Pure model for the floor's "something needs you" alerts. No database and safe in the browser:
 *  each poll hands over what is ready or waiting now, and this says which of those are new to
 *  this screen, so a sound and a toast fire once per order and never for what was already there. */

export interface AlertOrder {
	id: string;
	code: string;
	tableLabel: string | null;
	orderType: string;
	/** 'online' | 'qr' | 'staff'; absent in older callers. */
	source?: string;
	fulfilment?: string | null;
	pickupAt?: Date | string | null;
	createdAt?: Date | string;
}

export interface AlertSnapshot {
	ready: AlertOrder[];
	qrWaiting: AlertOrder[];
}

/** The ids already shown on this screen. */
export interface SeenAlerts {
	ready: Set<string>;
	qrWaiting: Set<string>;
}

export const seenFrom = (s: AlertSnapshot): SeenAlerts => ({
	ready: new Set(s.ready.map((o) => o.id)),
	qrWaiting: new Set(s.qrWaiting.map((o) => o.id))
});

/** What appeared since `seen`. With nothing seen yet (first load on this screen) nothing is new:
 *  a waiter opening the page is not told about food that was already waiting. */
export function newAlerts(seen: SeenAlerts | null, now: AlertSnapshot): AlertSnapshot {
	if (!seen) return { ready: [], qrWaiting: [] };
	return {
		ready: now.ready.filter((o) => !seen.ready.has(o.id)),
		qrWaiting: now.qrWaiting.filter((o) => !seen.qrWaiting.has(o.id))
	};
}

/** `TB-1234 · Table 4`, `· Takeaway`, or for an online order `· Online pickup 6:30 PM` / `· Online delivery`. */
export function describeAlert(o: AlertOrder): string {
	if (o.source === 'online' && o.orderType !== 'pre_order') {
		if (o.fulfilment === 'delivery') return `${o.code} · Online delivery`;
		const at = o.pickupAt ? new Date(o.pickupAt) : null;
		const time = at && !Number.isNaN(at.getTime()) ? ` ${at.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}` : '';
		return `${o.code} · Online pickup${time}`;
	}
	const where = o.orderType === 'takeaway' ? 'Takeaway' : o.tableLabel ? `Table ${o.tableLabel}` : 'Dine-in';
	return `${o.code} · ${where}`;
}

/** How long an order may wait for staff before the alert starts repeating. */
export const OVERDUE_MS = 5 * 60_000;

/** Orders that have waited longer than `OVERDUE_MS` for someone to accept them. */
export function overdueAlerts(waiting: AlertOrder[], nowMs: number): AlertOrder[] {
	return waiting.filter((o) => o.createdAt && nowMs - new Date(o.createdAt).getTime() > OVERDUE_MS);
}
