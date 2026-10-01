import { describe, expect, it } from 'vitest';
import { DEMO_HOTELS, DEMO_SLUG_PREFIX, demoGuest, generateDemoBookings, guestPoolSize } from './demo-data';

const TODAY = '2026-10-01';
const bookings = generateDemoBookings(TODAY);

describe('generateDemoBookings', () => {
	it('is deterministic for a seed and different for another', () => {
		expect(generateDemoBookings(TODAY)).toEqual(bookings);
		expect(generateDemoBookings(TODAY, 14, 7)).not.toEqual(bookings);
	});

	it('produces a sensible volume across all demo hotels', () => {
		expect(bookings.length).toBeGreaterThan(1500);
		expect(bookings.length).toBeLessThan(12000);
		for (const h of DEMO_HOTELS) {
			expect(bookings.some((b) => b.hotelSlug === h.slug)).toBe(true);
			expect(h.slug.startsWith(DEMO_SLUG_PREFIX)).toBe(true);
		}
	});

	it('only creates valid stays', () => {
		for (const b of bookings) {
			expect(b.checkOut > b.checkIn).toBe(true);
			expect(b.occupancy).toBeGreaterThanOrEqual(1);
			expect(b.roomCount).toBeGreaterThanOrEqual(1);
			expect(b.guestIndex).toBeLessThan(guestPoolSize(DEMO_HOTELS.find((h) => h.slug === b.hotelSlug)!));
		}
	});

	it('assigns status from where the stay falls relative to today', () => {
		for (const b of bookings) {
			if (b.checkOut < TODAY) expect(['checked_out', 'cancelled', 'no_show']).toContain(b.status);
			else if (b.checkIn <= TODAY) expect(['checked_in', 'cancelled']).toContain(b.status);
			else expect(['confirmed', 'cancelled', 'pending_payment']).toContain(b.status);
		}
		const visits = bookings.filter((b) => b.status === 'checked_out' || b.status === 'checked_in');
		expect(visits.length / bookings.length).toBeGreaterThan(0.7);
	});

	it('respects a hotel that opened recently and shows a December peak', () => {
		const pension = bookings.filter((b) => b.hotelSlug === 'demo-garden-pension');
		const earliest = pension.reduce((m, b) => (b.checkIn < m ? b.checkIn : m), '9999');
		expect(earliest >= '2026-05-01').toBe(true);
		const big = bookings.filter((b) => b.hotelSlug === 'demo-city-center-suites' && b.status === 'checked_out');
		const inMonth = (m: string) => big.filter((b) => b.checkIn.startsWith(m)).length;
		expect(inMonth('2025-12')).toBeGreaterThan(inMonth('2025-11'));
	});
});

describe('demoGuest', () => {
	it('uses an undeliverable reserved domain and is stable', () => {
		const g = demoGuest('demo-seaside-inn', 5);
		expect(g.email.endsWith('.demo.invalid')).toBe(true);
		expect(demoGuest('demo-seaside-inn', 5)).toEqual(g);
		expect(demoGuest('demo-seaside-inn', 6).email).not.toBe(g.email);
	});
});
