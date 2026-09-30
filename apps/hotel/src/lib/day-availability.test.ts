import { describe, expect, it } from 'vitest';
import {
	addDays,
	computeDayAvailability,
	nightsAreFree,
	roomsLeftForType,
	type DayStatus
} from './day-availability';

const deluxe = { id: 'd', totalRooms: 4 };
const suite = { id: 's', totalRooms: 1 };

describe('addDays', () => {
	it('crosses month and year ends', () => {
		expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
		expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
	});
});

describe('computeDayAvailability', () => {
	it('is free with no bookings', () => {
		const [d] = computeDayAvailability([deluxe], [], '2026-11-01', 1);
		expect(d).toEqual({ date: '2026-11-01', status: 'free', roomsLeft: 4 });
	});

	it('treats checkout day as free: night D is not held by a stay ending on D', () => {
		const b = [{ roomTypeId: 'd', checkIn: '2026-11-01', checkOut: '2026-11-03', quantity: 4 }];
		const days = computeDayAvailability([deluxe], b, '2026-11-01', 3);
		expect(days.map((d) => d.status)).toEqual(['full', 'full', 'free']);
	});

	it('is "few" when the best room type has 2 or fewer rooms left', () => {
		const b = [{ roomTypeId: 'd', checkIn: '2026-11-01', checkOut: '2026-11-02', quantity: 2 }];
		expect(computeDayAvailability([deluxe], b, '2026-11-01', 1)[0]!.status).toBe('few');
	});

	it('stays free while any room type still has plenty, even if another is sold out', () => {
		const b = [{ roomTypeId: 's', checkIn: '2026-11-01', checkOut: '2026-11-02', quantity: 1 }];
		const [d] = computeDayAvailability([deluxe, suite], b, '2026-11-01', 1);
		expect(d).toMatchObject({ status: 'free', roomsLeft: 4 });
	});

	it('is full only when every room type is sold out', () => {
		const b = [
			{ roomTypeId: 'd', checkIn: '2026-11-01', checkOut: '2026-11-02', quantity: 4 },
			{ roomTypeId: 's', checkIn: '2026-11-01', checkOut: '2026-11-02', quantity: 1 }
		];
		expect(computeDayAvailability([deluxe, suite], b, '2026-11-01', 1)[0]).toMatchObject({
			status: 'full',
			roomsLeft: 0
		});
	});

	it('never goes negative when bookings exceed rooms', () => {
		const b = [{ roomTypeId: 'd', checkIn: '2026-11-01', checkOut: '2026-11-02', quantity: 9 }];
		expect(computeDayAvailability([deluxe], b, '2026-11-01', 1)[0]!.roomsLeft).toBe(0);
	});
});

describe('nightsAreFree', () => {
	const status = new Map<string, DayStatus>([
		['2026-11-02', 'full'],
		['2026-11-03', 'free']
	]);
	it('rejects a range that spans a sold-out night', () => {
		expect(nightsAreFree(status, '2026-11-01', '2026-11-04')).toBe(false);
	});
	it('allows checking out on a sold-out date (that night is not used)', () => {
		expect(nightsAreFree(status, '2026-11-01', '2026-11-02')).toBe(true);
	});
	it('treats dates outside the loaded window as bookable', () => {
		expect(nightsAreFree(status, '2027-05-01', '2027-05-03')).toBe(true);
	});
});

describe('roomsLeftForType', () => {
	it('counts only bookings of that type holding that night', () => {
		const b = [
			{ roomTypeId: 'd', checkIn: '2026-11-01', checkOut: '2026-11-03', quantity: 3 },
			{ roomTypeId: 's', checkIn: '2026-11-01', checkOut: '2026-11-03', quantity: 1 }
		];
		expect(roomsLeftForType(deluxe, b, '2026-11-02')).toBe(1);
		expect(roomsLeftForType(deluxe, b, '2026-11-03')).toBe(4);
	});
});
