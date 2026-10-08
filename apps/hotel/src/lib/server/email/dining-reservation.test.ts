import { describe, expect, it } from 'vitest';
import { renderDiningReservation, type DiningReservationEmailData } from './dining-reservation';

const base = (over: Partial<DiningReservationEmailData> = {}): DiningReservationEmailData => ({
	hotel: {
		name: 'Acacia Hotel',
		city: 'Davao City',
		address: '123 Ledger St',
		contactEmail: 'stay@acacia.example',
		contactPhone: '+63 82 000 0000',
		logoUrl: null,
		accentColor: '#836819',
		paperColor: '#ffffff'
	},
	guestName: 'Maria Santos',
	venueTitle: 'Waling Waling Café',
	code: 'TB-7K4Q',
	partySize: 4,
	dateLabel: 'Sat, Oct 10, 2026',
	timeLabel: '7:30 PM',
	remarks: null,
	ticketUrl: 'https://hotel.example/acacia/dining/reserve/TB-7K4Q?t=abc',
	...over
});

describe('renderDiningReservation', () => {
	it('puts the code in the subject and both bodies, with the ticket link', () => {
		const m = renderDiningReservation(base());
		expect(m.subject).toBe('Table reserved at Waling Waling Café: TB-7K4Q');
		for (const body of [m.html, m.text]) {
			expect(body).toContain('TB-7K4Q');
			expect(body).toContain('7:30 PM');
			expect(body).toContain('https://hotel.example/acacia/dining/reserve/TB-7K4Q?t=abc');
		}
		expect(m.text).toContain('Party: 4');
	});

	it('includes the guest note only when there is one', () => {
		expect(renderDiningReservation(base()).text).not.toContain('Note:');
		const m = renderDiningReservation(base({ remarks: 'Window seat' }));
		expect(m.text).toContain('Note: Window seat');
		expect(m.html).toContain('Window seat');
	});

	it('escapes HTML in guest-supplied text', () => {
		const m = renderDiningReservation(base({ guestName: '<b>Eve</b>', remarks: '"><script>x</script>' }));
		expect(m.html).not.toContain('<b>Eve</b>');
		expect(m.html).not.toContain('<script>');
		expect(m.html).toContain('&lt;b&gt;Eve&lt;/b&gt;');
	});

	it('falls back to the default accent when the stored colour is not a hex value', () => {
		const m = renderDiningReservation(base({ hotel: { ...base().hotel, accentColor: 'oklch(0.4 0.1 60)' } }));
		expect(m.html).toContain('#836819');
	});
});
