import { describe, expect, it } from 'vitest';
import { renderTestEmail, type TestEmailData } from './test-email';

const base: TestEmailData = {
	hotel: {
		name: 'MM Hotel',
		city: 'Davao City',
		logoUrl: null,
		accentColor: '#836819',
		paperColor: '#ffffff'
	},
	fromAddress: 'reservations@mmhotel.ph',
	mailboxLabel: 'Your mailbox (smtp.gmail.com)',
	sentAtLabel: 'Sep 23, 2026, 4:15 PM'
};

describe('renderTestEmail', () => {
	it('names the hotel and the sending mailbox', () => {
		const { subject, html, text } = renderTestEmail(base);
		expect(subject).toBe('Test email from MM Hotel');
		expect(html).toContain('Your email is working');
		expect(html).toContain('reservations@mmhotel.ph');
		expect(html).toContain('Your mailbox (smtp.gmail.com)');
		expect(text).toContain('Sent from:  reservations@mmhotel.ph');
	});

	it('uses the warm band for a white-paper hotel, like the other guest emails', () => {
		expect(renderTestEmail(base).html).toContain('background:#f4f1ea');
	});

	it('escapes hotel-provided text', () => {
		const html = renderTestEmail({ ...base, hotel: { ...base.hotel, name: 'A <b>&</b> B' } }).html;
		expect(html).not.toContain('<b>&</b>');
		expect(html).toContain('A &lt;b&gt;&amp;&lt;/b&gt; B');
	});

	it('falls back to the default accent for a malformed colour', () => {
		const html = renderTestEmail({ ...base, hotel: { ...base.hotel, accentColor: 'red' } }).html;
		expect(html).not.toContain('color:red');
	});
});
