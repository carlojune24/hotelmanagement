import { describe, expect, it } from 'vitest';
import { otherDaysNotes } from './shift-days';

describe('otherDaysNotes', () => {
	it('says nothing for a same-day shift', () => {
		expect(otherDaysNotes([], '2026-09-23')).toEqual([]);
	});

	it('names the later date and which Z-reading the cash belongs to', () => {
		const [note] = otherDaysNotes(
			[{ businessDate: '2026-09-24', cashInCentavos: 50_000, cashOutCentavos: 0 }],
			'2026-09-23'
		);
		expect(note).toContain('₱500.00 taken');
		expect(note).toContain("Sep 24's Z-reading, not Sep 23's");
		expect(note).not.toContain('paid out');
	});

	it('mentions payouts only when there were some', () => {
		const [note] = otherDaysNotes(
			[{ businessDate: '2026-09-24', cashInCentavos: 50_000, cashOutCentavos: 5_000 }],
			'2026-09-23'
		);
		expect(note).toContain('₱50.00 paid out');
	});
});
