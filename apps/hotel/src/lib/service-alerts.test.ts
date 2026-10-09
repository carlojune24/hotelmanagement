import { describe, expect, it } from 'vitest';
import { describeAlert, newAlerts, seenFrom, type AlertOrder, type AlertSnapshot } from './service-alerts';

const o = (id: string, tableLabel: string | null = '4', orderType = 'dine_in'): AlertOrder => ({
	id,
	code: `TB-${id}`,
	tableLabel,
	orderType
});
const snap = (ready: AlertOrder[], qrWaiting: AlertOrder[] = []): AlertSnapshot => ({ ready, qrWaiting });

describe('newAlerts', () => {
	it('says nothing on the first load, so opening the page does not ring for food already waiting', () => {
		expect(newAlerts(null, snap([o('1')], [o('2')]))).toEqual({ ready: [], qrWaiting: [] });
	});

	it('reports only orders that were not on the screen before', () => {
		const seen = seenFrom(snap([o('1')], [o('5')]));
		const fresh = newAlerts(seen, snap([o('1'), o('2')], [o('5'), o('6')]));
		expect(fresh.ready.map((x) => x.id)).toEqual(['2']);
		expect(fresh.qrWaiting.map((x) => x.id)).toEqual(['6']);
	});

	it('does not repeat itself once an order has been seen, or when something leaves', () => {
		const seen = seenFrom(snap([o('1'), o('2')]));
		expect(newAlerts(seen, snap([o('1'), o('2')]))).toEqual({ ready: [], qrWaiting: [] });
		expect(newAlerts(seen, snap([o('2')]))).toEqual({ ready: [], qrWaiting: [] });
	});
});

describe('describeAlert', () => {
	it('names the order and where it goes', () => {
		expect(describeAlert(o('1', '12'))).toBe('TB-1 · Table 12');
		expect(describeAlert(o('2', null, 'takeaway'))).toBe('TB-2 · Takeaway');
		expect(describeAlert(o('3', null))).toBe('TB-3 · Dine-in');
	});
});
