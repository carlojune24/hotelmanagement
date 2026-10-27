import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { APP_ORIGIN: 'https://hotels.example.com/' } }));
const { hotelOrigin } = await import('./hotel-origin');

describe('hotelOrigin', () => {
	it('uses the hotel custom domain when set', () => {
		expect(hotelOrigin({ customDomain: 'mmhotelsbooking.com' })).toBe('https://mmhotelsbooking.com');
	});
	it('falls back to the platform ORIGIN without a trailing slash', () => {
		expect(hotelOrigin({ customDomain: null })).toBe('https://hotels.example.com');
	});
});
