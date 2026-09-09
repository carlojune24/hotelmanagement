import { describe, expect, it } from 'vitest';
import { advanceDueDate, changeFor, expectedShiftCash, inputVatOf, toCsv } from './calc';

describe('inputVatOf', () => {
	it('splits VAT-inclusive gross at 12% (1200 bps)', () => {
		// 1,120.00 gross → 120.00 VAT
		expect(inputVatOf(112_000, 1200)).toBe(12_000);
	});
	it('rounds to the nearest centavo', () => {
		expect(inputVatOf(100_00, 1200)).toBe(Math.round((10_000 * 1200) / 11_200));
	});
	it('is zero at a zero rate', () => {
		expect(inputVatOf(100_000, 0)).toBe(0);
	});
});

describe('advanceDueDate', () => {
	it('adds 7 days for weekly', () => {
		expect(advanceDueDate('2026-09-07', 'weekly', 0)).toBe('2026-09-14');
	});
	it('moves to the anchor day next month for monthly', () => {
		expect(advanceDueDate('2026-01-15', 'monthly', 15)).toBe('2026-02-15');
	});
	it('clamps the anchor day to the shorter month', () => {
		expect(advanceDueDate('2026-01-31', 'monthly', 31)).toBe('2026-02-28');
	});
	it('advances a quarter and a year', () => {
		expect(advanceDueDate('2026-01-10', 'quarterly', 10)).toBe('2026-04-10');
		expect(advanceDueDate('2026-01-10', 'annually', 10)).toBe('2027-01-10');
	});
});

describe('expectedShiftCash', () => {
	it('is float + cash in − cash out', () => {
		expect(expectedShiftCash(500_000, 1_200_000, 300_000)).toBe(1_400_000);
	});
	it('variance is counted − expected', () => {
		const expected = expectedShiftCash(500_000, 1_000_000, 0);
		expect(1_499_500 - expected).toBe(-500); // short by ₱5
	});
});

describe('changeFor', () => {
	it('returns the overpayment on a cash tender', () => {
		expect(changeFor(200_000, 175_050)).toBe(24_950);
	});
	it('never goes negative', () => {
		expect(changeFor(100_000, 150_000)).toBe(0);
	});
});

describe('toCsv', () => {
	it('quotes fields with commas, quotes and newlines', () => {
		const csv = toCsv(
			['a', 'b'],
			[
				['plain', 'has, comma'],
				['has "quote"', 'line\nbreak']
			]
		);
		expect(csv).toBe('a,b\r\nplain,"has, comma"\r\n"has ""quote""","line\nbreak"');
	});
});
