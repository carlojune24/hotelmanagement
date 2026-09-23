import { describe, expect, it } from 'vitest';
import { suggestedExtensionHours } from './extension-hours';

const at = (hhmm: string) => Date.parse(`2026-09-24T${hhmm}:00+08:00`);

describe('suggestedExtensionHours', () => {
	it('late checkout: 12:00 due, left 5:07 PM → 5h (odd minutes round down)', () => {
		expect(suggestedExtensionHours(at('12:00'), at('17:07'))).toBe(5);
	});

	it('keeps half hours: left 1:45 PM → 1.5h', () => {
		expect(suggestedExtensionHours(at('12:00'), at('13:45'))).toBe(1.5);
	});

	it('early check-in: arrived 10:00 AM for a 2:00 PM check-in → 4h', () => {
		expect(suggestedExtensionHours(at('10:00'), at('14:00'))).toBe(4);
	});

	it('suggests nothing under half an hour', () => {
		expect(suggestedExtensionHours(at('12:00'), at('12:29'))).toBe(0);
	});

	it('suggests nothing when on time or not early', () => {
		expect(suggestedExtensionHours(at('12:00'), at('11:00'))).toBe(0);
	});

	it('suggests nothing for a missing timestamp', () => {
		expect(suggestedExtensionHours(Number.NaN, at('12:00'))).toBe(0);
	});
});
