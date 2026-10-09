/** Pure kitchen models: the Prep list and the History figures. No database and safe in the
 *  browser; the server feeds these rows and the pages render what comes back. */
import { DEFAULT_TARGET_MINUTES } from './dining-orders';

const ms = (d: Date | string) => new Date(d).getTime();

// ---------------------------------------------------------------------------
// Prep list: what to cook right now, added up across every open ticket
// ---------------------------------------------------------------------------

export interface PrepOrder {
	id: string;
	code: string;
	status: string;
	createdAt: Date | string;
	pickupAt?: Date | string | null;
	tableLabel: string | null;
	orderType: string;
	items: {
		id: string;
		name: string;
		quantity: number;
		remarks: string | null;
		stationName: string | null;
		startedAt: Date | string | null;
		readyAt: Date | string | null;
		addons: string[];
	}[];
}

export interface PrepTicketLine {
	orderId: string;
	code: string;
	quantity: number;
	where: string;
	/** Add-ons and the guest's note for this line, in the words the cook reads. */
	notes: string[];
	started: boolean;
	createdAt: Date | string;
	pickupAt: Date | string | null;
}

export interface PrepDish {
	name: string;
	/** Portions still to make on this station (everything not yet marked ready). */
	quantity: number;
	/** Of those, portions already started. */
	cooking: number;
	tickets: PrepTicketLine[];
	oldestAt: Date | string;
}

export interface PrepStation {
	/** The station name, or '' for dishes with no station. */
	key: string;
	label: string;
	dishes: PrepDish[];
	portions: number;
}

const OPEN = new Set(['new', 'accepted', 'preparing']);

const whereOf = (o: Pick<PrepOrder, 'orderType' | 'tableLabel'>) =>
	o.orderType === 'takeaway' ? 'Takeaway' : o.tableLabel ? `Table ${o.tableLabel}` : 'Dine-in';

/**
 * Everything still to be made, grouped by station and then by dish, biggest pile first. A dish
 * that is already ready drops out; one that is started stays but counts under `cooking`. Stations
 * follow the configured order, then any other station named on a ticket, then dishes with no
 * station (called Kitchen when the hotel has no stations at all).
 */
export function buildPrepList(orders: PrepOrder[], stationNames: string[]): PrepStation[] {
	const byStation = new Map<string, Map<string, PrepDish>>();
	for (const order of orders) {
		if (!OPEN.has(order.status)) continue;
		for (const it of order.items) {
			if (it.readyAt) continue;
			const key = it.stationName ?? '';
			const dishes = byStation.get(key) ?? new Map<string, PrepDish>();
			byStation.set(key, dishes);
			const dish = dishes.get(it.name) ?? { name: it.name, quantity: 0, cooking: 0, tickets: [], oldestAt: order.createdAt };
			dishes.set(it.name, dish);
			dish.quantity += it.quantity;
			if (it.startedAt) dish.cooking += it.quantity;
			if (ms(order.createdAt) < ms(dish.oldestAt)) dish.oldestAt = order.createdAt;
			dish.tickets.push({
				orderId: order.id,
				code: order.code,
				quantity: it.quantity,
				where: whereOf(order),
				notes: [...it.addons.map((a) => `+ ${a}`), ...(it.remarks ? [`“${it.remarks}”`] : [])],
				started: !!it.startedAt,
				createdAt: order.createdAt,
				pickupAt: order.pickupAt ?? null
			});
		}
	}

	const strays = [...byStation.keys()].filter((k) => k !== '' && !stationNames.includes(k)).sort();
	const keys = [...stationNames.filter((n) => byStation.has(n)), ...strays];
	if (byStation.has('')) keys.push('');
	const named = stationNames.length > 0 || strays.length > 0;

	return keys.map((key) => {
		const dishes = [...(byStation.get(key)?.values() ?? [])]
			.map((d) => ({ ...d, tickets: d.tickets.sort((a, b) => ms(a.createdAt) - ms(b.createdAt)) }))
			.sort((a, b) => b.quantity - a.quantity || ms(a.oldestAt) - ms(b.oldestAt) || a.name.localeCompare(b.name));
		return {
			key,
			label: key || (named ? 'Unassigned' : 'Kitchen'),
			dishes,
			portions: dishes.reduce((n, d) => n + d.quantity, 0)
		};
	});
}

// ---------------------------------------------------------------------------
// History: how the kitchen has been doing
// ---------------------------------------------------------------------------

/** One cooked line, as the server reads it. */
export interface HistoryRow {
	orderId: string;
	/** When the guest or waiter placed the order: the clock the board's "Waiting" runs on. */
	orderedAt: Date | string;
	stationName: string | null;
	name: string;
	quantity: number;
	startedAt: Date | string | null;
	readyAt: Date | string;
	readyByUserId: string | null;
}

export interface StationStats {
	/** The station name, or '' for dishes with no station. */
	key: string;
	label: string;
	/** Tickets (one station's part of an order) finished in the period. */
	tickets: number;
	avgMinutes: number;
	p90Minutes: number;
	/** How many of those took at least the station's target. */
	late: number;
	latePct: number;
	targetMinutes: number;
}

export interface KitchenSummary {
	tickets: number;
	portions: number;
	avgMinutes: number;
	late: number;
	latePct: number;
	stations: StationStats[];
	/** Tickets finished per hour of the hotel's day (0–23). */
	byHour: { hour: number; tickets: number }[];
	topDishes: { name: string; quantity: number }[];
	cooks: { userId: string | null; tickets: number }[];
}

interface Part {
	key: string;
	orderedAt: number;
	readyAt: number;
	readyBy: string | null;
}

/** Nearest-rank percentile of a list of numbers; 0 for an empty list. */
export function percentile(values: number[], p: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}

/** The hour (0–23) an instant falls in, on the hotel's own clock. */
export function hourIn(timezone: string, at: number): number {
	const h = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: timezone }).format(at);
	return Number(h) % 24;
}

/**
 * Figures for a period. A "ticket" is one station's part of an order, finished when its last line
 * is ready; it is timed from when the order was placed, the same clock the board shows, and is
 * late once that reaches the station's target (the default when it has none).
 */
export function summarizeKitchen(
	rows: HistoryRow[],
	stations: { name: string; targetMinutes: number | null }[],
	timezone: string
): KitchenSummary {
	const targetOf = new Map(stations.map((s) => [s.name, s.targetMinutes ?? DEFAULT_TARGET_MINUTES]));
	const target = (key: string) => targetOf.get(key) ?? DEFAULT_TARGET_MINUTES;

	// Roll lines up into parts: the part is done when its last line is, and credited to that line's cook.
	const parts = new Map<string, Part>();
	const dishes = new Map<string, number>();
	let portions = 0;
	for (const r of rows) {
		const key = r.stationName ?? '';
		const id = `${r.orderId}\u0000${key}`;
		const readyAt = ms(r.readyAt);
		const part = parts.get(id);
		if (!part || readyAt >= part.readyAt) {
			parts.set(id, { key, orderedAt: ms(r.orderedAt), readyAt, readyBy: r.readyByUserId });
		}
		dishes.set(r.name, (dishes.get(r.name) ?? 0) + r.quantity);
		portions += r.quantity;
	}

	const minutesOf = (p: Part) => Math.max(0, (p.readyAt - p.orderedAt) / 60_000);
	const all = [...parts.values()];
	const named = stations.length > 0 || all.some((p) => p.key !== '');

	const keys = [...new Set([...stations.map((s) => s.name), ...all.map((p) => p.key)])].filter((k) =>
		all.some((p) => p.key === k)
	);
	const stationStats: StationStats[] = keys.map((key) => {
		const mine = all.filter((p) => p.key === key);
		const times = mine.map(minutesOf);
		const late = times.filter((m) => m >= target(key)).length;
		return {
			key,
			label: key || (named ? 'Unassigned' : 'Kitchen'),
			tickets: mine.length,
			avgMinutes: Math.round(times.reduce((a, b) => a + b, 0) / mine.length),
			p90Minutes: Math.round(percentile(times, 90)),
			late,
			latePct: Math.round((late / mine.length) * 100),
			targetMinutes: target(key)
		};
	});

	const hours = new Array<number>(24).fill(0);
	for (const p of all) hours[hourIn(timezone, p.readyAt)]!++;

	const cookCount = new Map<string | null, number>();
	for (const p of all) cookCount.set(p.readyBy, (cookCount.get(p.readyBy) ?? 0) + 1);

	const lateTotal = all.filter((p) => minutesOf(p) >= target(p.key)).length;
	return {
		tickets: all.length,
		portions,
		avgMinutes: all.length ? Math.round(all.reduce((a, p) => a + minutesOf(p), 0) / all.length) : 0,
		late: lateTotal,
		latePct: all.length ? Math.round((lateTotal / all.length) * 100) : 0,
		stations: stationStats,
		byHour: hours.map((tickets, hour) => ({ hour, tickets })),
		topDishes: [...dishes.entries()]
			.map(([name, quantity]) => ({ name, quantity }))
			.sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name))
			.slice(0, 8),
		cooks: [...cookCount.entries()]
			.map(([userId, tickets]) => ({ userId, tickets }))
			.sort((a, b) => b.tickets - a.tickets)
	};
}
