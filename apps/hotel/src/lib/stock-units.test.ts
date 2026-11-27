import { describe, expect, it } from 'vitest';
import { formatQty, toMilli } from './stock-units';

describe('stock units', () => {
	it('converts entered quantities to thousandths of the base unit', () => {
		expect(toMilli(1.5, 'kg', 'g')).toBe(1_500_000);
		expect(toMilli(0.5, 'pcs', 'pcs')).toBe(500);
		expect(toMilli(2, 'dozen', 'pcs')).toBe(24_000);
		expect(toMilli(1, 'tsp', 'ml')).toBe(4_929);
	});

	it('refuses a unit from another base (no oz on a volume item)', () => {
		expect(toMilli(1, 'oz', 'ml')).toBeNull();
		expect(toMilli(1, 'kg', 'pcs')).toBeNull();
		expect(toMilli(Number.NaN, 'g', 'g')).toBeNull();
	});

	it('formats, stepping up to kg / L', () => {
		expect(formatQty(250_000, 'g')).toBe('250 g');
		expect(formatQty(2_500_000, 'g')).toBe('2.5 kg');
		expect(formatQty(-1_500, 'pcs')).toBe('-1.5 pcs');
		expect(formatQty(1_000_000, 'ml')).toBe('1 L');
	});
});
