import { describe, expect, it } from 'vitest';
import { renderGuestMessageReply, type GuestMessageReplyEmailData } from './guest-message-reply';

const base: GuestMessageReplyEmailData = {
	hotel: {
		name: 'Test Hotel',
		city: 'Davao',
		logoUrl: null,
		accentColor: '#836819',
		paperColor: '#ffffff'
	},
	guestName: 'Ana Reyes',
	confirmationCode: 'ABCD1234',
	replyBody: 'We can move your check-in to 3pm, no problem.',
	manageUrl: 'https://book.example/acacia/book/manage/abc?t=tok'
};

describe('renderGuestMessageReply', () => {
	it('produces subject, html and text', () => {
		const r = renderGuestMessageReply(base);
		expect(r.subject).toBe('Test Hotel replied to your message — ABCD1234');
		expect(r.html).toContain('<!doctype html>');
		expect(r.html).toContain('The hotel replied');
		expect(r.html).toContain('We can move your check-in to 3pm, no problem.');
		expect(r.text).toContain('THE HOTEL REPLIED');
		expect(r.text).toContain('We can move your check-in to 3pm, no problem.');
	});

	it('links to the manage page', () => {
		const r = renderGuestMessageReply(base);
		expect(r.html).toContain(base.manageUrl);
		expect(r.text).toContain(base.manageUrl);
	});

	it('escapes hotel, guest name, and reply body', () => {
		const r = renderGuestMessageReply({
			...base,
			hotel: { ...base.hotel, name: 'A & B <Hotel>' },
			guestName: "O'Brien <x>",
			replyBody: 'See <script>alert(1)</script> & reply.'
		});
		expect(r.html).toContain('A &amp; B &lt;Hotel&gt;');
		expect(r.html).not.toContain('<Hotel>');
		expect(r.html).not.toContain('<script>');
		expect(r.html).toContain('&amp; reply.');
	});

	it('falls back to safe defaults for a malformed accent/paper colour', () => {
		const r = renderGuestMessageReply({
			...base,
			hotel: { ...base.hotel, accentColor: 'not-a-hex', paperColor: 'nope' }
		});
		expect(r.html).toContain('#836819');
	});

	it('preserves line breaks in the reply body', () => {
		const r = renderGuestMessageReply({ ...base, replyBody: 'Line one.\nLine two.' });
		expect(r.html).toContain('white-space:pre-wrap');
	});
});
