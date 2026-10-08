import { describe, expect, it } from 'vitest';
import { compareUrgency, floorCounts, matchesFilter, tableView, urgencyRank, type FloorCheck, type FloorReservation } from './dining-floor';
import { summarizeCheck } from './dining-checks';

const at = new Date('2026-10-08T12:00:00Z');
const mins = (n: number) => new Date(at.getTime() + n * 60_000);
const turnMs = 90 * 60_000;
const res = (id: string, status: string, startMin: number, tableIds = ['t1'], lenMin = 90): FloorReservation => ({
	id,
	status,
	startsAt: mins(startMin),
	endsAt: mins(startMin + lenMin),
	tableIds
});
const check = (over: Partial<FloorCheck> = {}): FloorCheck => ({
	stage: 'ordering',
	openedAt: mins(-30),
	billRequestedAt: null,
	readyCount: 0,
	awaitingAcceptance: 0,
	...over
});
const view = (over: Parameters<typeof tableView>[0] extends infer A ? Partial<A> : never = {}) =>
	tableView({ tableId: 't1', reservations: [], at, turnMs, ...over });

describe('tableView', () => {
	it('is free with nothing on it, and shows the next booking', () => {
		const v = view({ reservations: [res('r', 'confirmed', 180)] });
		expect(v.stage).toBe('free');
		expect(v.next?.id).toBe('r');
	});

	it('is reserved when a booking starts within the turn time, and not for another table\'s booking', () => {
		expect(view({ reservations: [res('r', 'confirmed', 60)] }).stage).toBe('reserved');
		expect(view({ reservations: [res('r', 'pending', 0)] }).stage).toBe('reserved');
		expect(view({ reservations: [res('r', 'confirmed', 60, ['t2'])] }).stage).toBe('free');
		expect(view({ reservations: [res('r', 'cancelled', 0)] }).stage).toBe('free');
	});

	it('is seated once a seated reservation has started', () => {
		const v = view({ reservations: [res('r', 'seated', -20)] });
		expect(v.stage).toBe('seated');
		expect(v.reservation?.id).toBe('r');
	});

	it('is occupied while a check is open, whatever the reservations say, and carries the check\'s signals', () => {
		const v = view({ check: check({ readyCount: 2, billRequestedAt: mins(-1) }), reservations: [res('r', 'confirmed', 30)] });
		expect(v.stage).toBe('occupied');
		expect(v.foodReady).toBe(2);
		expect(v.billAsked).toBe(true);
		expect(v.seatedSince).toEqual(mins(-30));
		expect(view({ check: check({ stage: 'needs_payment' }) }).stage).toBe('needs_payment');
		expect(view({ check: check({ stage: 'ready_to_clear' }) }).stage).toBe('ready_to_clear');
	});

	it('counts QR orders waiting, on a free table or an occupied one', () => {
		expect(view({ awaiting: 2 }).qrWaiting).toBe(2);
		expect(view({ awaiting: 1, check: check({ awaitingAcceptance: 1 }) }).qrWaiting).toBe(2);
	});
});

describe('urgency', () => {
	const named = (name: string, over: Parameters<typeof view>[0]) => ({ name, view: view(over) });

	it('puts food to serve first, then QR orders, the bill, clearing, occupied, reserved, free', () => {
		const list = [
			named('free', {}),
			named('reserved', { reservations: [res('r', 'confirmed', 30)] }),
			named('occupied', { check: check() }),
			named('clear', { check: check({ stage: 'ready_to_clear' }) }),
			named('pay', { check: check({ stage: 'needs_payment' }) }),
			named('bill', { check: check({ stage: 'needs_payment', billRequestedAt: mins(-2) }) }),
			named('qr', { awaiting: 1 }),
			named('serve', { check: check({ readyCount: 1 }) })
		];
		expect(list.sort(compareUrgency).map((x) => x.name)).toEqual(['serve', 'qr', 'bill', 'pay', 'clear', 'occupied', 'reserved', 'free']);
	});

	it('puts the table that has been there longest first within a rank, then by name', () => {
		const list = [
			named('T10', { check: check({ openedAt: mins(-10) }) }),
			named('T2', { check: check({ openedAt: mins(-50) }) }),
			named('T3', { check: check({ openedAt: mins(-50) }) })
		];
		expect(list.sort(compareUrgency).map((x) => x.name)).toEqual(['T2', 'T3', 'T10']);
		expect(urgencyRank(view({ check: check({ readyCount: 1 }) }))).toBe(0);
	});
});

describe('filters and counts', () => {
	it('filters overlap: a table can be occupied and have food to serve', () => {
		const v = view({ check: check({ readyCount: 1 }) });
		expect(matchesFilter(v, 'occupied')).toBe(true);
		expect(matchesFilter(v, 'serve')).toBe(true);
		expect(matchesFilter(v, 'free')).toBe(false);
		expect(matchesFilter(v, 'all')).toBe(true);
	});

	it('counts each filter', () => {
		const views = [view({}), view({}), view({ check: check({ readyCount: 1 }) }), view({ check: check({ stage: 'needs_payment' }) }), view({ awaiting: 1 })];
		const c = floorCounts(views);
		expect(c).toMatchObject({ all: 5, free: 3, occupied: 2, serve: 1, pay: 1, qr: 1, clear: 0, reserved: 0 });
	});
});

describe('summarizeCheck ready and cooking counts', () => {
	const o = (status: string, paymentStatus = 'unpaid') => ({ status, paymentStatus, totalCentavos: 1000 });
	it('splits unserved orders into cooking and ready to serve', () => {
		const s = summarizeCheck([o('new'), o('preparing'), o('ready'), o('served', 'paid'), o('cancelled'), o('pending_acceptance')], false);
		expect(s).toMatchObject({ cookingCount: 2, readyCount: 1, inProgress: 3, awaitingAcceptance: 1 });
	});
	it('is zero for both when everything is served', () => {
		expect(summarizeCheck([o('served', 'paid')], false)).toMatchObject({ cookingCount: 0, readyCount: 0 });
	});
});
