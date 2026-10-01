import { describe, expect, it } from 'vitest';
import {
	DEMO_HOTELS,
	DEMO_QUALITY,
	DEMO_SLUG_PREFIX,
	demoGuest,
	generateDemoBookings,
	generateDemoReviews,
	guestPoolSize
} from './demo-data';

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

describe('generateDemoReviews', () => {
	const reviews = generateDemoReviews(bookings, TODAY);

	it('is deterministic and reviews only completed stays, once each', () => {
		expect(generateDemoReviews(bookings, TODAY)).toEqual(reviews);
		const seen = new Set<number>();
		for (const r of reviews) {
			expect(bookings[r.bookingIndex]!.status).toBe('checked_out');
			expect(seen.has(r.bookingIndex)).toBe(false);
			seen.add(r.bookingIndex);
		}
	});

	it('submits after checkout and never in the future, with a valid rating', () => {
		for (const r of reviews) {
			const b = bookings[r.bookingIndex]!;
			expect(r.submittedOn >= b.checkOut).toBe(true);
			expect(r.submittedOn <= TODAY).toBe(true);
			expect([1, 2, 3, 4, 5]).toContain(r.rating);
			expect(r.comment.length).toBeGreaterThan(10);
			expect(r.displayName).toMatch(/^\S+ \S\.$/);
		}
	});

	it('reviews roughly a quarter of completed stays and leaves a pending backlog', () => {
		const done = bookings.filter((b) => b.status === 'checked_out').length;
		expect(reviews.length / done).toBeGreaterThan(0.2);
		expect(reviews.length / done).toBeLessThan(0.3);
		const by = (s: string) => reviews.filter((r) => r.status === s).length;
		expect(by('approved')).toBeGreaterThan(by('pending'));
		expect(by('pending')).toBeGreaterThan(0);
		expect(by('rejected')).toBeGreaterThan(0);
	});

	it('gives each hotel a mean close to its target quality, with best and worst ordered', () => {
		const mean = (slug: string) => {
			const rs = reviews.filter((r) => bookings[r.bookingIndex]!.hotelSlug === slug);
			return rs.reduce((a, r) => a + r.rating, 0) / rs.length;
		};
		for (const [slug, q] of Object.entries(DEMO_QUALITY)) expect(Math.abs(mean(slug) - q)).toBeLessThan(0.4);
		expect(mean('demo-highland-lodge')).toBeGreaterThan(mean('demo-garden-pension'));
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
