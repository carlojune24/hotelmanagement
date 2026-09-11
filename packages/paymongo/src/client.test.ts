import { afterEach, describe, expect, it, vi } from 'vitest';
import { PayMongoClient, PayMongoError } from './client';

function mockFetchOnce(status: number, body: unknown) {
	const fetchMock = vi.fn().mockResolvedValue({
		ok: status >= 200 && status < 300,
		status,
		json: async () => body
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('PayMongoClient', () => {
	it('requires a secret key', () => {
		// @ts-expect-error deliberately omitted
		expect(() => new PayMongoClient({})).toThrow(/secretKey/);
	});

	it('sends HTTP Basic auth with the secret key as username', async () => {
		const fetchMock = mockFetchOnce(200, { data: { id: 'cs_1' } });
		const client = new PayMongoClient({ secretKey: 'sk_test_abc' });
		await client.request('/checkout_sessions/cs_1');

		const [url, init] = fetchMock.mock.calls[0]!;
		expect(url).toBe('https://api.paymongo.com/v1/checkout_sessions/cs_1');
		expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('sk_test_abc:').toString('base64')}`);
	});

	it('creates a checkout session with the expected envelope', async () => {
		const fetchMock = mockFetchOnce(200, {
			data: { id: 'cs_1', type: 'checkout_session', attributes: { checkout_url: 'https://x' } }
		});
		const client = new PayMongoClient({ secretKey: 'sk_test_abc' });
		const session = await client.createCheckoutSession({
			line_items: [{ amount: 1000, currency: 'PHP', name: 'Room', quantity: 1 }],
			success_url: 'https://a/success',
			cancel_url: 'https://a/cancel',
			payment_method_types: ['gcash']
		});

		expect(session.id).toBe('cs_1');
		const [, init] = fetchMock.mock.calls[0]!;
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({
			data: {
				attributes: {
					line_items: [{ amount: 1000, currency: 'PHP', name: 'Room', quantity: 1 }],
					success_url: 'https://a/success',
					cancel_url: 'https://a/cancel',
					payment_method_types: ['gcash']
				}
			}
		});
	});

	it('throws PayMongoError on a non-2xx response', async () => {
		mockFetchOnce(400, { errors: [{ detail: 'bad request' }] });
		const client = new PayMongoClient({ secretKey: 'sk_test_abc' });
		await expect(client.retrieveCheckoutSession('cs_1')).rejects.toBeInstanceOf(PayMongoError);
	});
});
