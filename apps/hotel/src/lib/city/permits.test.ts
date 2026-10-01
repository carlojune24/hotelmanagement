import { describe, expect, it } from 'vitest';
import { countByStatus, currentPermits, daysUntil, permitStatus } from './permits';

describe('permitStatus', () => {
	const today = '2026-10-01';
	it('is valid through the expiry date and expired the day after', () => {
		expect(permitStatus('2026-10-01', today)).toBe('expiring');
		expect(permitStatus('2026-09-30', today)).toBe('expired');
	});
	it('flags permits expiring within 60 days', () => {
		expect(permitStatus('2026-11-30', today)).toBe('expiring'); // 60 days
		expect(permitStatus('2026-12-01', today)).toBe('valid'); // 61 days
	});
	it('handles no permit', () => {
		expect(permitStatus(null, today)).toBe('none');
		expect(permitStatus(undefined, today)).toBe('none');
	});
	it('counts days across month and year boundaries', () => {
		expect(daysUntil('2027-01-01', '2026-12-31')).toBe(1);
		expect(daysUntil('2026-10-01', '2026-10-01')).toBe(0);
		expect(daysUntil('2026-09-20', '2026-10-01')).toBe(-11);
	});
});

describe('currentPermits', () => {
	it('keeps the latest-expiring permit per hotel (renewals supersede)', () => {
		const m = currentPermits([
			{ id: '1', hotelId: 'a', permitNumber: 'OLD', expiresOn: '2025-12-31' },
			{ id: '2', hotelId: 'a', permitNumber: 'NEW', expiresOn: '2026-12-31' },
			{ id: '3', hotelId: 'b', permitNumber: 'B1', expiresOn: '2026-01-01' }
		]);
		expect(m.get('a')!.permitNumber).toBe('NEW');
		expect(m.get('b')!.id).toBe('3');
		expect(m.size).toBe(2);
	});
});

describe('countByStatus', () => {
	it('tallies every status, including zeros', () => {
		expect(countByStatus(['valid', 'expired', 'expired', 'none'])).toEqual({
			valid: 1,
			expiring: 0,
			expired: 2,
			none: 1
		});
	});
});
