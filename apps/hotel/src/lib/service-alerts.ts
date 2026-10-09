/** Pure model for the floor's "something needs you" alerts. No database and safe in the browser:
 *  each poll hands over what is ready or waiting now, and this says which of those are new to
 *  this screen, so a sound and a toast fire once per order and never for what was already there. */

export interface AlertOrder {
	id: string;
	code: string;
	tableLabel: string | null;
	orderType: string;
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

/** `TB-1234 · Table 4`, or `· Takeaway`. */
export function describeAlert(o: AlertOrder): string {
	const where = o.orderType === 'takeaway' ? 'Takeaway' : o.tableLabel ? `Table ${o.tableLabel}` : 'Dine-in';
	return `${o.code} · ${where}`;
}
