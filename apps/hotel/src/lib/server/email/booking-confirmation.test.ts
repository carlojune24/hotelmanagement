import { describe, expect, it } from 'vitest';
import {
	renderBookingConfirmation,
	stayNights,
	type BookingConfirmationData
} from './booking-confirmation';

const base = (over: Partial<BookingConfirmationData> = {}): BookingConfirmationData => ({
	hotel: {
		name: 'Acacia Hotel',
		city: 'Davao City',
		address: '123 Ledger St',
		contactEmail: 'stay@acacia.example',
		contactPhone: '+63 82 000 0000',
		logoUrl: null,
		checkInTime: '14:00:00',
		checkOutTime: '12:00:00',
		accentColor: '#836819',
		paperColor: '#ffffff',
		currency: 'PHP'
	},
	guestName: 'Maria Santos',
	confirmationCode: 'A1B2C3D4',
	roomLines: [
		{
			roomTypeName: 'Deluxe Twin',
			ratePlanName: 'Standard Rate',
			quantity: 1,
			checkIn: '2026-11-03',
			checkOut: '2026-11-06'
		}
	],
	hallLines: [],
	subtotalCentavos: 900_00,
	feesCentavos: 0,
	vatCentavos: 108_00,
	totalCentavos: 1008_00,
	manageUrl: 'https://book.example/acacia/book/confirmation/abc?t=tok',
	...over
});

describe('stayNights', () => {
	it('is the longest stay across room lines', () => {
		expect(
			stayNights([
				{ roomTypeName: '', ratePlanName: '', quantity: 1, checkIn: '2026-11-03', checkOut: '2026-11-06' },
				{ roomTypeName: '', ratePlanName: '', quantity: 1, checkIn: '2026-11-03', checkOut: '2026-11-05' }
			])
		).toBe(3);
	});
	it('is 0 with no room lines (hall-only)', () => {
		expect(stayNights([])).toBe(0);
	});
});

describe('renderBookingConfirmation', () => {
	it('puts the hotel name and code in the subject', () => {
		const { subject } = renderBookingConfirmation(base());
		expect(subject).toBe('Booking confirmed at Acacia Hotel — A1B2C3D4');
	});

	it('includes code, guest, total, nights and the manage URL in the HTML', () => {
		const { html } = renderBookingConfirmation(base());
		expect(html).toContain('A1B2C3D4');
		expect(html).toContain('Maria Santos');
		expect(html).toContain('₱1,008.00');
		expect(html).toContain('>3<'); // nights value cell
		expect(html).toContain('https://book.example/acacia/book/confirmation/abc?t=tok');
		expect(html).toContain('Deluxe Twin — Standard Rate');
	});

	it('renders check-in / check-out clock times', () => {
		const { html, text } = renderBookingConfirmation(base());
		expect(html).toContain('2:00 PM');
		expect(html).toContain('12:00 PM');
		expect(text).toContain('from 2:00 PM');
	});

	it('omits the Fees row when fees are zero and shows it otherwise', () => {
		expect(renderBookingConfirmation(base()).html).not.toMatch(/>Fees</);
		const withFees = renderBookingConfirmation(base({ feesCentavos: 50_00 }));
		expect(withFees.html).toMatch(/>Fees</);
		expect(withFees.html).toContain('₱50.00');
	});

	it('uses the per-hotel accent colour, falling back to gold for a bad value', () => {
		expect(renderBookingConfirmation(base()).html).toContain('#836819');
		const custom = renderBookingConfirmation(
			base({ hotel: { ...base().hotel, accentColor: '#1d4ed8' } })
		);
		expect(custom.html).toContain('#1d4ed8');
		const bad = renderBookingConfirmation(
			base({ hotel: { ...base().hotel, accentColor: 'not-a-hex' } })
		);
		expect(bad.html).toContain('#836819');
	});

	it('handles a hall-only booking: no nights/room rows, hall line present', () => {
		const { html, text } = renderBookingConfirmation(
			base({
				roomLines: [],
				hallLines: [
					{
						hallName: 'Narra Ballroom',
						eventType: 'Wedding',
						eventDate: '2026-12-12',
						startTime: '18:00:00',
						endTime: '23:00:00'
					}
				]
			})
		);
		expect(html).toContain('Narra Ballroom');
		expect(html).toContain('6:00 PM');
		expect(html).not.toMatch(/>Nights</);
		expect(text).toContain('Narra Ballroom');
		expect(text).not.toContain('Nights');
	});

	it('escapes HTML in guest-controlled text', () => {
		const { html } = renderBookingConfirmation(base({ guestName: '<script>x</script>' }));
		expect(html).not.toContain('<script>x</script>');
		expect(html).toContain('&lt;script&gt;');
	});

	it('plain-text alternative carries the URL on its own line', () => {
		const { text } = renderBookingConfirmation(base());
		const lines = text.split('\n');
		expect(lines).toContain('https://book.example/acacia/book/confirmation/abc?t=tok');
		expect(text).toContain('TOTAL PAID  ₱1,008.00');
	});
});
