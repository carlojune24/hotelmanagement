/** Pure model for the kitchen board's station lanes. No database and safe in the browser:
 *  the board shows each station only the dishes it has to make, so a cook watches one lane
 *  instead of reading every order. */
import { groupByStation, type StationGroup, type StationLine } from './dining-orders';

/** The minimum an order needs for the lane model. */
export interface LaneOrder<L extends StationLine> {
	id: string;
	status: string;
	createdAt: Date | string;
	readyAt?: Date | string | null;
	items: L[];
}

export interface LaneCard<T, L extends StationLine> {
	order: T;
	/** This station's part of the order. */
	group: StationGroup<L>;
	state: 'waiting' | 'cooking';
	/** The order's other stations, so a cook can see what the table is still waiting for. */
	elsewhere: StationGroup<L>[];
}

export interface Lane<T, L extends StationLine> {
	/** The station name, or '' for dishes with no station. */
	key: string;
	label: string;
	targetMinutes: number | null;
	cards: LaneCard<T, L>[];
	waiting: number;
	cooking: number;
}

/** Orders the kitchen still has work on. Ready, served and cancelled ones are off every lane. */
const ACTIVE = new Set(['new', 'accepted', 'preparing']);

const time = (d: Date | string) => new Date(d).getTime();

/**
 * One lane per configured station (in the order given), plus a lane for any station name that
 * appears on an order but is no longer configured, plus an Unassigned lane for dishes with no
 * station (called Kitchen when the hotel has no stations at all). A card sits in a lane until
 * that station's part is ready; cards are oldest-order first.
 */
export function buildLanes<T extends LaneOrder<StationLine>>(
	orders: T[],
	stations: { name: string; targetMinutes: number | null }[]
): Lane<T, T['items'][number]>[] {
	type L = T['items'][number];
	const active = orders.filter((o) => ACTIVE.has(o.status)).sort((a, b) => time(a.createdAt) - time(b.createdAt));
	const byKey = new Map<string, LaneCard<T, L>[]>();
	for (const order of active) {
		const groups = groupByStation(order.items as L[]);
		for (const group of groups) {
			if (group.state === 'ready') continue;
			const card: LaneCard<T, L> = {
				order,
				group,
				state: group.state === 'cooking' ? 'cooking' : 'waiting',
				elsewhere: groups.filter((g) => g.key !== group.key)
			};
			byKey.set(group.key, [...(byKey.get(group.key) ?? []), card]);
		}
	}

	const targets = new Map(stations.map((s) => [s.name, s.targetMinutes]));
	const configured = stations.map((s) => s.name);
	const strays = [...byKey.keys()].filter((k) => k !== '' && !targets.has(k)).sort();
	const keys = [...configured, ...strays];
	// Dishes with no station: a lane of their own when there are some, and always when no stations exist.
	if (byKey.has('') || keys.length === 0) keys.push('');

	return keys.map((key) => {
		const cards = byKey.get(key) ?? [];
		return {
			key,
			label: key || (configured.length > 0 || strays.length > 0 ? 'Unassigned' : 'Kitchen'),
			targetMinutes: targets.get(key) ?? null,
			cards,
			waiting: cards.filter((c) => c.state === 'waiting').length,
			cooking: cards.filter((c) => c.state === 'cooking').length
		};
	});
}

/** Orders every station has finished and nobody has served yet, oldest ready first. */
export function passList<T extends LaneOrder<StationLine>>(orders: T[]): T[] {
	return orders
		.filter((o) => o.status === 'ready')
		.sort((a, b) => time(a.readyAt ?? a.createdAt) - time(b.readyAt ?? b.createdAt));
}
