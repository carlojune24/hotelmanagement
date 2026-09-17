import { describe, expect, it } from 'vitest';
import { renderBookingReviewRequest, type ReviewRequestEmailData } from './booking-review-request';

const base: ReviewRequestEmailData = {
	hotel: {
		name: 'Test Hotel',
		city: 'Davao',
		contactEmail: 'front@testhotel.ph',
		contactPhone: '+63 900 000 0000',
		logoUrl: null,
		accentColor: '#836819',
		paperColor: '#ffffff'
	},
	guestName: 'Ana Reyes',
	confirmationCode: 'ABCD1234',
	roomTypeName: 'Deluxe Twin',
	reviewUrl: 'https://testhotel.example/testhotel/leave-review/abc123?t=tok'
};

describe('renderBookingReviewRequest', () => {
	it('produces subject, html and text', () => {
		const r = renderBookingReviewRequest(base);
		expect(r.subject).toBe('How was your stay at Test Hotel?');
		expect(r.html).toContain('<!doctype html>');
		expect(r.html).toContain('How was your stay?');
		expect(r.text).toContain('HOW WAS YOUR STAY?');
	});

	it('links to the review page', () => {
		const r = renderBookingReviewRequest(base);
		expect(r.html).toContain(base.reviewUrl);
		expect(r.text).toContain(base.reviewUrl);
	});

	it('names the room type stayed in', () => {
		const r = renderBookingReviewRequest(base);
		expect(r.html).toContain('Deluxe Twin');
		expect(r.text).toContain('Deluxe Twin');
	});

	it('escapes hotel and guest names', () => {
		const r = renderBookingReviewRequest({
			...base,
			hotel: { ...base.hotel, name: 'A & B <Hotel>' },
			guestName: "O'Brien <x>"
		});
		expect(r.html).toContain('A &amp; B &lt;Hotel&gt;');
		expect(r.html).not.toContain('<Hotel>');
	});

	it('falls back to safe defaults for a malformed accent/paper colour', () => {
		const r = renderBookingReviewRequest({
			...base,
			hotel: { ...base.hotel, accentColor: 'not-a-hex', paperColor: 'nope' }
		});
		expect(r.html).toContain('#836819');
	});
});
