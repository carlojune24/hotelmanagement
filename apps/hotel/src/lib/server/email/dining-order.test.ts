import { describe, expect, it } from 'vitest';
import { renderDiningOrder, type DiningOrderEmailData } from './dining-order';

const base = (over: Partial<DiningOrderEmailData> = {}): DiningOrderEmailData => ({
	kind: 'confirmation',
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
	code: 'DN-7K4Q',
	orderType: 'takeaway',
	pickupDateLabel: 'Sat, Oct 10',
	pickupTimeLabel: '7:30 PM',
	items: [
		{ name: 'Adobo', quantity: 2, addons: ['Garlic rice'], remarks: 'no onions', lineTotalCentavos: 53_000 },
		{ name: 'Soda', quantity: 1, addons: [], remarks: null, lineTotalCentavos: 8_000 }
	],
	totalCentavos: 61_000,
	payment: 'paid',
	remarks: null,
	trackUrl: 'https://hotel.example/acacia/dining/order/DN-7K4Q?t=abc',
	...over
});

describe('renderDiningOrder', () => {
	it('confirms a paid order with the code, pickup time, dishes, total and tracking link', () => {
		const m = renderDiningOrder(base());
		expect(m.subject).toBe('Order DN-7K4Q confirmed: Waling Waling Café');
		for (const body of [m.html, m.text]) {
			expect(body).toContain('DN-7K4Q');
			expect(body).toContain('Sat, Oct 10, 7:30 PM');
			expect(body).toContain('https://hotel.example/acacia/dining/order/DN-7K4Q?t=abc');
		}
		expect(m.text).toContain('2x Adobo  ₱530.00');
		expect(m.text).toContain('+ Garlic rice');
		expect(m.text).toContain('"no onions"');
		expect(m.text).toContain('Total (VAT included): ₱610.00');
		expect(m.text).toContain('Your payment is confirmed');
		expect(m.text).toMatch(/\nPaid\n/);
	});

	it('tells a pay-at-the-restaurant guest to pay on collection', () => {
		const m = renderDiningOrder(base({ payment: 'pay_at_venue' }));
		expect(m.text).toContain('Please pay when you collect it');
		expect(m.text).toContain('To pay at the restaurant');
		expect(m.text).not.toContain('payment is confirmed');
	});

	it('says the order is ready, with pickup wording for takeaway and table wording for a pre-order', () => {
		const pickup = renderDiningOrder(base({ kind: 'ready' }));
		expect(pickup.subject).toBe('Your order DN-7K4Q is ready: Acacia Hotel');
		expect(pickup.text).toContain('ready for pickup');
		const table = renderDiningOrder(base({ kind: 'ready', orderType: 'pre_order' }));
		expect(table.text).toContain('ready to serve');
		expect(table.text).toContain('Table time: Sat, Oct 10, 7:30 PM');
	});

	it('copes with no pickup time and includes the order note only when there is one', () => {
		const m = renderDiningOrder(base({ pickupDateLabel: null, pickupTimeLabel: null }));
		expect(m.text).not.toContain('Pickup:');
		expect(renderDiningOrder(base()).text).not.toContain('Note:');
		expect(renderDiningOrder(base({ remarks: 'Extra napkins' })).text).toContain('Note: Extra napkins');
	});

	it('escapes HTML in guest-supplied text', () => {
		const m = renderDiningOrder(
			base({
				guestName: '<b>Eve</b>',
				remarks: '"><script>x</script>',
				items: [{ name: '<img src=x>', quantity: 1, addons: ['<i>'], remarks: '<u>', lineTotalCentavos: 100 }]
			})
		);
		expect(m.html).not.toContain('<script>');
		expect(m.html).not.toContain('<img src=x>');
		expect(m.html).not.toContain('<b>Eve</b>');
		expect(m.html).toContain('&lt;b&gt;Eve&lt;/b&gt;');
	});
});
