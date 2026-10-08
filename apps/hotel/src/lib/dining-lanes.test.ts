import { describe, expect, it } from 'vitest';
import { buildLanes, passList } from './dining-lanes';

const t = (n: number) => new Date(2026, 9, 8, 12, n);
const line = (stationName: string | null, startedAt: Date | null = null, readyAt: Date | null = null) => ({ stationName, startedAt, readyAt });
const order = (id: string, status: string, created: number, items: ReturnType<typeof line>[], readyAt: Date | null = null) => ({
	id,
	status,
	createdAt: t(created),
	readyAt,
	items
});
const stations = [
	{ name: 'Kitchen', targetMinutes: 20 },
	{ name: 'Bar', targetMinutes: 5 },
	{ name: 'Pastry', targetMinutes: null }
];

describe('buildLanes', () => {
	it('makes a lane per configured station, in the order given, even when empty', () => {
		const lanes = buildLanes([], stations);
		expect(lanes.map((l) => [l.key, l.cards.length])).toEqual([['Kitchen', 0], ['Bar', 0], ['Pastry', 0]]);
		expect(lanes.map((l) => l.targetMinutes)).toEqual([20, 5, null]);
	});

	it('gives each station only its own part of an order, oldest order first', () => {
		const lanes = buildLanes(
			[
				order('late', 'new', 10, [line('Kitchen'), line('Bar')]),
				order('early', 'new', 1, [line('Kitchen')])
			],
			stations
		);
		const kitchen = lanes.find((l) => l.key === 'Kitchen')!;
		expect(kitchen.cards.map((c) => c.order.id)).toEqual(['early', 'late']);
		const bar = lanes.find((l) => l.key === 'Bar')!;
		expect(bar.cards.map((c) => c.order.id)).toEqual(['late']);
		expect(bar.cards[0]!.group.items).toHaveLength(1);
		expect(lanes.find((l) => l.key === 'Pastry')!.cards).toEqual([]);
	});

	it('tells a cook what the table is still waiting for', () => {
		const lanes = buildLanes([order('o', 'preparing', 1, [line('Kitchen', t(2)), line('Bar', t(2), t(5))])], stations);
		const kitchen = lanes.find((l) => l.key === 'Kitchen')!;
		expect(kitchen.cards[0]!.state).toBe('cooking');
		expect(kitchen.cards[0]!.elsewhere.map((g) => [g.key, g.state])).toEqual([['Bar', 'ready']]);
		// the bar is done, so its lane no longer shows the order
		expect(lanes.find((l) => l.key === 'Bar')!.cards).toEqual([]);
	});

	it('counts waiting and cooking per lane', () => {
		const lanes = buildLanes(
			[order('a', 'new', 1, [line('Bar')]), order('b', 'preparing', 2, [line('Bar', t(3))]), order('c', 'preparing', 3, [line('Bar', t(4))])],
			stations
		);
		const bar = lanes.find((l) => l.key === 'Bar')!;
		expect([bar.waiting, bar.cooking]).toEqual([1, 2]);
	});

	it('leaves ready, served, cancelled and not-yet-accepted orders off every lane', () => {
		const lanes = buildLanes(
			['ready', 'served', 'cancelled', 'pending_acceptance', 'pending_payment'].map((s, i) => order(`o${i}`, s, i, [line('Kitchen')])),
			stations
		);
		expect(lanes.every((l) => l.cards.length === 0)).toBe(true);
	});

	it('adds an Unassigned lane for dishes with no station, and a lane for a station that was deleted', () => {
		const lanes = buildLanes([order('o', 'new', 1, [line(null), line('Old station')])], stations);
		expect(lanes.map((l) => l.key)).toEqual(['Kitchen', 'Bar', 'Pastry', 'Old station', '']);
		expect(lanes.at(-1)!.label).toBe('Unassigned');
	});

	it('is a single Kitchen lane when the hotel has no stations at all', () => {
		const lanes = buildLanes([order('o', 'new', 1, [line(null)])], []);
		expect(lanes.map((l) => [l.key, l.label, l.cards.length])).toEqual([['', 'Kitchen', 1]]);
		expect(buildLanes([], []).map((l) => l.label)).toEqual(['Kitchen']);
	});
});

describe('passList', () => {
	it('lists ready orders, the one ready longest first', () => {
		const list = passList([
			order('a', 'ready', 1, [line('Bar', t(1), t(9))], t(9)),
			order('b', 'ready', 2, [line('Bar', t(1), t(4))], t(4)),
			order('c', 'preparing', 3, [line('Bar', t(1))]),
			order('d', 'served', 4, [line('Bar', t(1), t(2))], t(2))
		]);
		expect(list.map((o) => o.id)).toEqual(['b', 'a']);
	});
});
