import { describe, expect, it } from 'vitest';
import { amountInWords, assembleLiquidationRows, formatSerial, type LiquidationEntry } from './documents';

describe('formatSerial', () => {
	it('zero-pads the numeric part and groups it away from the prefix', () => {
		expect(formatSerial('OR', 42, 6)).toBe('OR-000042');
		expect(formatSerial('INV', 7, 6)).toBe('INV-000007');
	});
	it('does not double a separator the prefix already ends with', () => {
		expect(formatSerial('INV-', 1, 4)).toBe('INV-0001');
		expect(formatSerial('OR/', 3, 4)).toBe('OR/0003');
	});
	it('does not truncate a number wider than the pad width', () => {
		expect(formatSerial('OR', 1234567, 4)).toBe('OR-1234567');
	});
	it('treats a pad width below 1 as 1', () => {
		expect(formatSerial('X', 7, 0)).toBe('X-7');
	});
});

describe('amountInWords', () => {
	it('renders whole pesos and centavos in the accountable-form form', () => {
		expect(amountInWords(123_450)).toBe('ONE THOUSAND TWO HUNDRED THIRTY-FOUR PESOS AND 50/100 ONLY');
	});
	it('handles zero', () => {
		expect(amountInWords(0)).toBe('ZERO PESOS AND 00/100 ONLY');
	});
	it('handles values below one peso', () => {
		expect(amountInWords(5)).toBe('ZERO PESOS AND 05/100 ONLY');
	});
	it('handles hundreds and tens without a scale word', () => {
		expect(amountInWords(90_000)).toBe('NINE HUNDRED PESOS AND 00/100 ONLY');
		expect(amountInWords(1_900)).toBe('NINETEEN PESOS AND 00/100 ONLY');
	});
	it('handles millions', () => {
		expect(amountInWords(250_000_000)).toBe('TWO MILLION FIVE HUNDRED THOUSAND PESOS AND 00/100 ONLY');
	});
	it('marks a negative amount', () => {
		expect(amountInWords(-10_000)).toBe('MINUS ONE HUNDRED PESOS AND 00/100 ONLY');
	});
});

describe('assembleLiquidationRows', () => {
	const entry = (serialNo: number, status: LiquidationEntry['status']): LiquidationEntry => ({
		serialNo,
		formattedNo: `OR-${String(serialNo).padStart(6, '0')}`,
		status,
		documentId: `doc-${serialNo}`,
		type: 'official_receipt',
		billToName: 'Guest',
		grossCentavos: status === 'spoiled' ? null : 100_00,
		at: new Date('2026-09-08'),
		reason: status === 'issued' ? null : 'x',
		byName: 'Cashier'
	});

	it('collapses a fully unused range into one row', () => {
		const { rows, summary } = assembleLiquidationRows(1, 10000, 'OR', 6, []);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ status: 'unused', serialFrom: 1, serialTo: 10000, count: 10000 });
		expect(summary).toEqual({ issued: 0, cancelled: 0, spoiled: 0, unused: 10000, total: 10000 });
	});

	it('splits unused runs around consumed serials and counts each status', () => {
		const { rows, summary } = assembleLiquidationRows(1, 10, 'OR', 6, [
			entry(1, 'issued'),
			entry(2, 'issued'),
			entry(4, 'cancelled'),
			entry(7, 'spoiled')
		]);
		expect(rows.map((r) => [r.status, r.serialFrom, r.serialTo])).toEqual([
			['issued', 1, 1],
			['issued', 2, 2],
			['unused', 3, 3],
			['cancelled', 4, 4],
			['unused', 5, 6],
			['spoiled', 7, 7],
			['unused', 8, 10]
		]);
		expect(summary).toEqual({ issued: 2, cancelled: 1, spoiled: 1, unused: 6, total: 10 });
	});

	it('handles a range with no trailing unused numbers', () => {
		const { rows, summary } = assembleLiquidationRows(1, 2, 'OR', 6, [
			entry(1, 'issued'),
			entry(2, 'issued')
		]);
		expect(rows).toHaveLength(2);
		expect(summary.unused).toBe(0);
	});

	it('uses the entry formattedNo for consumed rows and formats the prefix for unused ranges', () => {
		const { rows } = assembleLiquidationRows(1, 3, 'INV', 6, [entry(2, 'issued')]);
		expect(rows[0]).toMatchObject({ status: 'unused', formattedFrom: 'INV-000001', formattedTo: 'INV-000001' });
		expect(rows[1]?.formattedFrom).toBe('OR-000002'); // from the entry, not re-derived
		expect(rows[2]).toMatchObject({ status: 'unused', formattedFrom: 'INV-000003' });
	});
});
