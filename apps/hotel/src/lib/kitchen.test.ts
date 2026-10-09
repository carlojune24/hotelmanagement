import { describe, expect, it } from 'vitest';
import { buildPrepList, hourIn, percentile, summarizeKitchen, type HistoryRow, type PrepOrder } from './kitchen';

const at = (iso: string) => new Date(`2026-10-09T${iso}:00+08:00`);

const line = (over: Partial<PrepOrder['items'][number]> & { id: string; name: string }): PrepOrder['items'][number] => ({
	quantity: 1,
	remarks: null,
	stationName: 'Grill',
	startedAt: null,
	readyAt: null,
	addons: [],
	...over
});

const order = (over: Partial<PrepOrder> & { id: string; items: PrepOrder['items'] }): PrepOrder => ({
	code: over.id.toUpperCase(),
	status: 'new',
	createdAt: at('12:00'),
	tableLabel: '4',
	orderType: 'dine_in',
	...over
});

describe('buildPrepList', () => {
	it('adds the same dish up across tickets, biggest pile first', () => {
		const prep = buildPrepList(
			[
				order({ id: 'a', items: [line({ id: '1', name: 'Steak', quantity: 2 }), line({ id: '2', name: 'Fries', quantity: 1 })] }),
				order({ id: 'b', createdAt: at('12:05'), items: [line({ id: '3', name: 'Steak', quantity: 3 })] })
			],
			['Grill']
		);
		expect(prep).toHaveLength(1);
		expect(prep[0]!.label).toBe('Grill');
		expect(prep[0]!.portions).toBe(6);
		expect(prep[0]!.dishes.map((d) => [d.name, d.quantity])).toEqual([
			['Steak', 5],
			['Fries', 1]
		]);
		expect(prep[0]!.dishes[0]!.tickets.map((t) => t.code)).toEqual(['A', 'B']);
	});

	it('counts started portions as cooking and drops ready ones and finished orders', () => {
		const prep = buildPrepList(
			[
				order({
					id: 'a',
					status: 'preparing',
					items: [
						line({ id: '1', name: 'Steak', quantity: 2, startedAt: at('12:02') }),
						line({ id: '2', name: 'Soup', readyAt: at('12:04'), startedAt: at('12:01') })
					]
				}),
				order({ id: 'b', status: 'served', items: [line({ id: '3', name: 'Cake' })] }),
				order({ id: 'c', status: 'cancelled', items: [line({ id: '4', name: 'Pie' })] })
			],
			['Grill']
		);
		expect(prep[0]!.dishes.map((d) => [d.name, d.quantity, d.cooking])).toEqual([['Steak', 2, 2]]);
	});

	it('orders stations as configured, then strays, then unassigned, and carries notes and pickup time', () => {
		const prep = buildPrepList(
			[
				order({
					id: 'a',
					orderType: 'takeaway',
					pickupAt: at('13:00'),
					items: [
						line({ id: '1', name: 'Mojito', stationName: 'Bar', addons: ['extra mint'], remarks: 'no ice' }),
						line({ id: '2', name: 'Salad', stationName: null }),
						line({ id: '3', name: 'Cake', stationName: 'Old pastry' }),
						line({ id: '4', name: 'Steak', stationName: 'Grill' })
					]
				})
			],
			['Grill', 'Bar']
		);
		expect(prep.map((s) => s.label)).toEqual(['Grill', 'Bar', 'Old pastry', 'Unassigned']);
		const mojito = prep[1]!.dishes[0]!.tickets[0]!;
		expect(mojito.notes).toEqual(['+ extra mint', '“no ice”']);
		expect(mojito.where).toBe('Takeaway');
		expect(mojito.pickupAt).toEqual(at('13:00'));
	});

	it('calls a hotel with no stations one Kitchen', () => {
		const prep = buildPrepList([order({ id: 'a', items: [line({ id: '1', name: 'Rice', stationName: null })] })], []);
		expect(prep.map((s) => s.label)).toEqual(['Kitchen']);
	});
});

describe('percentile', () => {
	it('uses the nearest rank', () => {
		expect(percentile([], 90)).toBe(0);
		expect(percentile([5], 90)).toBe(5);
		expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
	});
});

describe('hourIn', () => {
	it('reads the hour on the hotel clock', () => {
		expect(hourIn('Asia/Manila', at('23:30').getTime())).toBe(23);
		expect(hourIn('UTC', at('01:30').getTime())).toBe(17);
	});
});

describe('summarizeKitchen', () => {
	const row = (over: Partial<HistoryRow> & { orderId: string; name: string }): HistoryRow => ({
		orderedAt: at('12:00'),
		stationName: 'Grill',
		quantity: 1,
		startedAt: at('12:02'),
		readyAt: at('12:10'),
		readyByUserId: 'u1',
		...over
	});

	it('times each station part from when the order was placed and flags the late ones', () => {
		const s = summarizeKitchen(
			[
				row({ orderId: 'a', name: 'Steak', quantity: 2, readyAt: at('12:10') }),
				// a second line of the same part: the part finishes with its last line
				row({ orderId: 'a', name: 'Fries', readyAt: at('12:15') }),
				row({ orderId: 'b', name: 'Steak', readyAt: at('12:30'), readyByUserId: 'u2' }),
				row({ orderId: 'a', name: 'Mojito', stationName: 'Bar', readyAt: at('12:05'), readyByUserId: 'u2' })
			],
			[
				{ name: 'Grill', targetMinutes: 20 },
				{ name: 'Bar', targetMinutes: null }
			],
			'Asia/Manila'
		);
		expect(s.tickets).toBe(3);
		expect(s.portions).toBe(5);
		const grill = s.stations.find((x) => x.key === 'Grill')!;
		expect(grill.tickets).toBe(2);
		expect(grill.avgMinutes).toBe(23); // (15 + 30) / 2, rounded
		expect(grill.late).toBe(1);
		expect(grill.latePct).toBe(50);
		expect(s.stations.find((x) => x.key === 'Bar')!.targetMinutes).toBe(20);
		expect(s.late).toBe(1);
		expect(s.topDishes[0]).toEqual({ name: 'Steak', quantity: 3 });
		expect(Object.fromEntries(s.cooks.map((c) => [c.userId, c.tickets]))).toEqual({ u1: 1, u2: 2 });
		expect(s.byHour[12]!.tickets).toBe(3);
	});

	it('is empty with nothing cooked', () => {
		const s = summarizeKitchen([], [{ name: 'Grill', targetMinutes: null }], 'Asia/Manila');
		expect(s).toMatchObject({ tickets: 0, portions: 0, avgMinutes: 0, latePct: 0, stations: [], cooks: [] });
	});
});
