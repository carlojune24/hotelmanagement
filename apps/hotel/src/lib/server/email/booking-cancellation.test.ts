import { describe, expect, it } from 'vitest';
import { renderBookingCancellation, type CancellationEmailData } from './booking-cancellation';

const base: CancellationEmailData = {
	hotel: {
		name: 'Test Hotel',
		city: 'Davao',
		contactEmail: 'front@testhotel.ph',
		contactPhone: '+63 900 000 0000',
		logoUrl: null,
		accentColor: '#836819',
		paperColor: '#ffffff',
		currency: 'PHP'
	},
	guestName: 'Ana Reyes',
	confirmationCode: 'ABCD1234',
	cancelledLabel: 'Deluxe Twin',
	orderFullyCancelled: true,
	feeCentavos: 112000,
	refundCentavos: 112000,
	refundMethodLabel: 'GCash'
};

describe('renderBookingCancellation', () => {
	it('produces subject, html and text', () => {
		const r = renderBookingCancellation(base);
		expect(r.subject).toBe('Booking cancelled at Test Hotel — ABCD1234');
		expect(r.html).toContain('<!doctype html>');
		expect(r.html).toContain('Reservation cancelled');
		expect(r.text).toContain('RESERVATION CANCELLED');
	});

	it('states the refund amount and method when a refund applies', () => {
		const r = renderBookingCancellation({ ...base, feeCentavos: 56000, refundCentavos: 56000 });
		expect(r.html).toContain('₱560.00');
		expect(r.html).toContain('GCash');
		expect(r.text).toContain('via GCash');
	});

	it('says nothing is refundable when the fee took everything', () => {
		const r = renderBookingCancellation({
			...base,
			feeCentavos: 112000,
			refundCentavos: 0,
			refundMethodLabel: null
		});
		expect(r.html).toMatch(/no amount is refundable/i);
		expect(r.html).not.toContain('Refund via');
	});

	it('says there is nothing to refund for an unpaid booking', () => {
		const r = renderBookingCancellation({
			...base,
			feeCentavos: 0,
			refundCentavos: 0,
			refundMethodLabel: null
		});
		expect(r.html).toMatch(/nothing to refund/i);
	});

	it('frames a partial cancellation as an update, not a full cancellation', () => {
		const r = renderBookingCancellation({ ...base, orderFullyCancelled: false });
		expect(r.html).toContain('Booking updated');
		expect(r.html).toMatch(/rest of your booking still stands/i);
		expect(r.subject).toContain('cancelled'); // subject stays stable
	});

	it('escapes hotel and guest names', () => {
		const r = renderBookingCancellation({
			...base,
			hotel: { ...base.hotel, name: 'A & B <Hotel>' },
			guestName: 'O\'Brien <x>'
		});
		expect(r.html).toContain('A &amp; B &lt;Hotel&gt;');
		expect(r.html).not.toContain('<Hotel>');
	});

	it('falls back to safe defaults for a malformed accent/paper colour', () => {
		const r = renderBookingCancellation({
			...base,
			hotel: { ...base.hotel, accentColor: 'not-a-hex', paperColor: 'nope' }
		});
		expect(r.html).toContain('#836819');
	});
});
