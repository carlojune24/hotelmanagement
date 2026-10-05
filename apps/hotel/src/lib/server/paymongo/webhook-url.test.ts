import { describe, expect, it } from 'vitest';
import { normalizePublicUrl, originOfWebhookUrl } from './webhook-url';

describe('normalizePublicUrl', () => {
	it('keeps a bare https origin', () => {
		expect(normalizePublicUrl('https://abc.ngrok-free.app')).toEqual({
			origin: 'https://abc.ngrok-free.app'
		});
	});

	it('drops a trailing slash and any pasted path', () => {
		expect(normalizePublicUrl(' https://abc.ngrok-free.app/api/webhooks/paymongo/ ')).toEqual({
			origin: 'https://abc.ngrok-free.app'
		});
	});

	it('assumes https when the scheme is missing', () => {
		expect(normalizePublicUrl('abc.ngrok-free.app')).toEqual({
			origin: 'https://abc.ngrok-free.app'
		});
	});

	it('rejects http, localhost and blanks', () => {
		expect(normalizePublicUrl('http://abc.ngrok-free.app')).toHaveProperty('error');
		expect(normalizePublicUrl('https://localhost:5173')).toHaveProperty('error');
		expect(normalizePublicUrl('  ')).toHaveProperty('error');
	});
});

describe('originOfWebhookUrl', () => {
	it('recovers the origin from a stored webhook URL', () => {
		expect(originOfWebhookUrl('https://abc.ngrok-free.app/api/webhooks/paymongo/mmhotel')).toBe(
			'https://abc.ngrok-free.app'
		);
		expect(originOfWebhookUrl(null)).toBe('');
	});
});
