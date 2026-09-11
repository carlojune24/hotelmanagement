import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parsePaymongoWebhookEvent, verifyPaymongoWebhookSignature } from './webhooks';

const secret = 'whsk_testsecret';
const body = JSON.stringify({ data: { id: 'evt_1', attributes: { type: 'checkout_session.payment.paid' } } });
const t = '1700000000';
const hash = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');

describe('verifyPaymongoWebhookSignature', () => {
	it('accepts a test-mode signature — te populated, li present but empty', () => {
		// This is the exact shape PayMongo sends for every test-mode delivery.
		// A `??` fallback instead of `||` breaks on this case: `li` is "" (not
		// nullish), so it wins over `te` and verification fails every time.
		const header = `t=${t},te=${hash},li=`;
		expect(verifyPaymongoWebhookSignature(body, header, secret)).toBe(true);
	});

	it('accepts a live-mode signature — li populated, te present but empty', () => {
		const header = `t=${t},te=,li=${hash}`;
		expect(verifyPaymongoWebhookSignature(body, header, secret)).toBe(true);
	});

	it('rejects a tampered body', () => {
		const header = `t=${t},te=${hash},li=`;
		expect(verifyPaymongoWebhookSignature(body + 'x', header, secret)).toBe(false);
	});

	it('rejects the wrong secret', () => {
		const header = `t=${t},te=${hash},li=`;
		expect(verifyPaymongoWebhookSignature(body, header, 'whsk_wrongsecret')).toBe(false);
	});

	it('rejects a header missing both signatures', () => {
		expect(verifyPaymongoWebhookSignature(body, `t=${t},te=,li=`, secret)).toBe(false);
	});

	it('rejects a header missing the timestamp', () => {
		expect(verifyPaymongoWebhookSignature(body, `te=${hash},li=`, secret)).toBe(false);
	});
});

describe('parsePaymongoWebhookEvent', () => {
	it('parses the envelope', () => {
		const event = parsePaymongoWebhookEvent(body);
		expect(event.data.id).toBe('evt_1');
		expect(event.data.attributes.type).toBe('checkout_session.payment.paid');
	});
});
