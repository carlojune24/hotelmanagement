import { describe, expect, it } from 'vitest';
import type { Webhook } from '@mm/paymongo';
import { pickReusableWebhook } from './webhook-reuse';

const hook = (id: string, url: string, status: 'enabled' | 'disabled' = 'enabled'): Webhook => ({
	id,
	type: 'webhook',
	attributes: { url, events: [], livemode: false, status }
});

const target = { url: 'https://new.ngrok-free.app/api/webhooks/paymongo/mmhotel', slug: 'mmhotel' };

describe('pickReusableWebhook', () => {
	it('reuses the stored webhook even though the tunnel URL changed', () => {
		const hooks = [hook('a', 'https://old.ngrok-free.app/api/webhooks/paymongo/mmhotel')];
		expect(pickReusableWebhook(hooks, { ...target, storedId: 'a' })?.id).toBe('a');
	});

	it('reuses a webhook already at the exact URL', () => {
		const hooks = [hook('x', 'https://other.app/hook'), hook('b', target.url)];
		expect(pickReusableWebhook(hooks, target)?.id).toBe('b');
	});

	it("reuses this hotel's webhook on an old host, enabled before disabled", () => {
		const hooks = [
			hook('dis', 'https://old1.ngrok-free.app/api/webhooks/paymongo/mmhotel', 'disabled'),
			hook('en', 'https://old2.ngrok-free.app/api/webhooks/paymongo/mmhotel')
		];
		expect(pickReusableWebhook(hooks, target)?.id).toBe('en');
	});

	it('adopts the legacy platform-wide webhook on first connect', () => {
		const hooks = [
			hook('old-dis', 'https://x.trycloudflare.com/api/webhooks/paymongo', 'disabled'),
			hook('legacy', 'https://e58d.ngrok-free.app/api/webhooks/paymongo/')
		];
		expect(pickReusableWebhook(hooks, target)?.id).toBe('legacy');
	});

	it("never takes another hotel's or another app's webhook", () => {
		const hooks = [
			hook('other-hotel', 'https://x.app/api/webhooks/paymongo/otherhotel'),
			hook('other-app', 'https://shop.example.com/paymongo')
		];
		expect(pickReusableWebhook(hooks, target)).toBeNull();
	});

	it('returns null for an empty account (create one)', () => {
		expect(pickReusableWebhook([], target)).toBeNull();
	});

	it('ignores a stored id that is not in this account (key switched)', () => {
		const hooks = [hook('live-1', 'https://x.app/api/webhooks/paymongo/mmhotel')];
		expect(pickReusableWebhook(hooks, { ...target, storedId: 'test-9' })?.id).toBe('live-1');
	});
});
