import { describe, expect, it } from 'vitest';
import {
	formatClockTime,
	formatStayDate,
	formatStayDateShort,
	nightsLabel,
	stayNights
} from './stay-dates';

describe('stay dates', () => {
	it('formats the calendar day as entered, never shifted by timezone', () => {
		expect(formatStayDate('2026-11-03')).toBe('Tue, Nov 3, 2026');
		expect(formatStayDateShort('2026-01-01')).toBe('Thu, Jan 1');
	});

	it('counts nights, including across a month end', () => {
		expect(stayNights('2026-11-03', '2026-11-06')).toBe(3);
		expect(stayNights('2026-01-30', '2026-02-02')).toBe(3);
	});

	it('is 0 for an empty, backwards or invalid range', () => {
		expect(stayNights('2026-11-03', '2026-11-03')).toBe(0);
		expect(stayNights('2026-11-06', '2026-11-03')).toBe(0);
		expect(stayNights('', '')).toBe(0);
	});

	it('pluralises nights', () => {
		expect(nightsLabel(1)).toBe('1 night');
		expect(nightsLabel(3)).toBe('3 nights');
	});

	it('formats a clock time on the 12-hour clock', () => {
		expect(formatClockTime('14:00:00')).toBe('2:00 PM');
		expect(formatClockTime('12:00:00')).toBe('12:00 PM');
		expect(formatClockTime('00:30:00')).toBe('12:30 AM');
		expect(formatClockTime('09:05')).toBe('9:05 AM');
		expect(formatClockTime('noon')).toBe('noon');
	});
});
