import { describe, expect, it } from 'vitest';
import {
	boardGroups,
	boardSummary,
	isUnpaid,
	itemsLine,
	matchesSearch,
	minutesSince,
	paymentLabel,
	tableChip,
	type BoardOrder
} from './orders-board';

const NOW = Date.parse('2026-10-09T12:00:00Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

let n = 0;
function order(over: Partial<BoardOrder> & { age?: number }): BoardOrder {
	const { age = 0, ...rest } = over;
	n += 1;
	return {
		id: `o${n}`,
		code: `DN-${String(n).padStart(4, '0')}`,
		status: 'new',
		paymentStatus: 'paid',
		orderType: 'dine_in',
		tableLabel: 'T1',
		guestName: null,
		createdAt: ago(age),
		readyAt: null,
		servedAt: null,
		totalCentavos: 10_000,
		items: [{ name: 'Pray Rays', quantity: 1 }],
		...rest
	};
}

describe('boardGroups', () => {
	it('puts each order in its section and keeps unaccepted QR and cancelled orders off the board', () => {
		const g = boardGroups(
			[
				order({ status: 'ready' }),
				order({ status: 'preparing' }),
				order({ status: 'new' }),
				order({ status: 'accepted' }),
				order({ status: 'served' }),
				order({ status: 'pending_acceptance' }),
				order({ status: 'cancelled' })
			],
			NOW
		);
		expect([g.ready.length, g.preparing.length, g.fresh.length, g.served.length]).toEqual([1, 1, 2, 1]);
	});

	it('lists ready orders longest-waiting first, measured from readyAt', () => {
		const a = order({ status: 'ready', age: 30, readyAt: ago(2) });
		const b = order({ status: 'ready', age: 10, readyAt: ago(9) });
		const c = order({ status: 'ready', age: 5, readyAt: ago(5) });
		expect(boardGroups([a, b, c], NOW).ready.map((o) => o.id)).toEqual([b.id, c.id, a.id]);
	});

	it('lists late preparing orders first, then oldest', () => {
		const young = order({ status: 'preparing', age: 2 });
		const old = order({ status: 'preparing', age: 12 });
		const late = order({ status: 'preparing', age: 25 });
		expect(boardGroups([young, old, late], NOW).preparing.map((o) => o.id)).toEqual([late.id, old.id, young.id]);
	});

	it('lists served orders most recent first', () => {
		const a = order({ status: 'served', servedAt: ago(60) });
		const b = order({ status: 'served', servedAt: ago(5) });
		expect(boardGroups([a, b], NOW).served.map((o) => o.id)).toEqual([b.id, a.id]);
	});

	it('narrows by search and by unpaid only', () => {
		const paid = order({ status: 'ready', paymentStatus: 'paid', tableLabel: 'T1' });
		const unpaid = order({ status: 'ready', paymentStatus: 'unpaid', tableLabel: 'T2' });
		const roomCharged = order({ status: 'ready', paymentStatus: 'room_charged', tableLabel: 'T3' });
		expect(boardGroups([paid, unpaid, roomCharged], NOW, { unpaidOnly: true }).ready.map((o) => o.id)).toEqual([unpaid.id]);
		expect(boardGroups([paid, unpaid, roomCharged], NOW, { query: 't3' }).ready.map((o) => o.id)).toEqual([roomCharged.id]);
	});
});

describe('boardSummary', () => {
	it('counts sections, the longest ready wait, late dishes and what is still to collect', () => {
		const s = boardSummary(
			[
				order({ status: 'ready', readyAt: ago(9), paymentStatus: 'unpaid', totalCentavos: 15_000 }),
				order({ status: 'ready', readyAt: ago(2), paymentStatus: 'unpaid', totalCentavos: 20_000 }),
				order({ status: 'ready', readyAt: ago(5) }),
				order({ status: 'preparing', age: 18 }),
				order({ status: 'preparing', age: 21 }),
				order({ status: 'new', age: 1 }),
				order({ status: 'served', paymentStatus: 'paid' }),
				order({ status: 'pending_acceptance', paymentStatus: 'unpaid', totalCentavos: 99_900 })
			],
			NOW
		);
		expect(s).toEqual({
			ready: 3,
			longestReadyMinutes: 9,
			preparing: 2,
			late: 1,
			fresh: 1,
			unpaid: 2,
			unpaidCentavos: 35_000
		});
	});

	it('is all zeroes for an empty board', () => {
		expect(boardSummary([], NOW)).toEqual({ ready: 0, longestReadyMinutes: 0, preparing: 0, late: 0, fresh: 0, unpaid: 0, unpaidCentavos: 0 });
	});
});

describe('matchesSearch', () => {
	const o = order({ code: 'DN-2XWE', tableLabel: 'T5', guestName: 'Maria Cruz', items: [{ name: 'Layua sa baboy', quantity: 1 }] });
	it('matches table, code, guest and dish, case-insensitively, all words required', () => {
		expect(matchesSearch(o, '')).toBe(true);
		expect(matchesSearch(o, 'table t5')).toBe(true);
		expect(matchesSearch(o, 'dn-2xwe')).toBe(true);
		expect(matchesSearch(o, 'maria')).toBe(true);
		expect(matchesSearch(o, 'LAYUA')).toBe(true);
		expect(matchesSearch(o, 'layua t5')).toBe(true);
		expect(matchesSearch(o, 'layua t9')).toBe(false);
	});
});

describe('helpers', () => {
	it('isUnpaid ignores unaccepted QR orders', () => {
		expect(isUnpaid({ paymentStatus: 'unpaid', status: 'ready' })).toBe(true);
		expect(isUnpaid({ paymentStatus: 'unpaid', status: 'pending_acceptance' })).toBe(false);
		expect(isUnpaid({ paymentStatus: 'room_charged', status: 'ready' })).toBe(false);
	});
	it('minutesSince floors and never goes negative', () => {
		expect(minutesSince(ago(5.9), NOW)).toBe(5);
		expect(minutesSince(new Date(NOW + 60_000).toISOString(), NOW)).toBe(0);
		expect(minutesSince(null, NOW)).toBe(0);
	});
	it('tableChip strips the word Table and caps the length', () => {
		expect(tableChip('T5')).toBe('T5');
		expect(tableChip('Table 12')).toBe('12');
		expect(tableChip('Terrace 1')).toBe('Terr');
		expect(tableChip(null)).toBeNull();
		expect(tableChip('  ')).toBeNull();
	});
	it('paymentLabel names how an order stands', () => {
		const p = (paymentStatus: string, paymentMethod: string | null = null, roomLabel: string | null = null) => ({ paymentStatus, paymentMethod, roomLabel });
		expect(paymentLabel(p('unpaid'))).toBe('Unpaid');
		expect(paymentLabel(p('paid', 'cash'))).toBe('Paid · Cash');
		expect(paymentLabel(p('paid', 'cash'), false)).toBe('Paid');
		expect(paymentLabel(p('paid', 'paymongo'))).toBe('Paid · Online');
		expect(paymentLabel(p('paid'))).toBe('Paid');
		expect(paymentLabel(p('room_charged', 'room_charge', '204'))).toBe('Room 204');
	});
	it('itemsLine joins quantity and name', () => {
		expect(itemsLine([{ name: 'A', quantity: 2 }, { name: 'B', quantity: 1 }])).toBe('2× A, 1× B');
	});
});
