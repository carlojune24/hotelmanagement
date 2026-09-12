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
		expect(init.headers.Authorization).toBe(
			`Basic ${Buffer.from('sk_test_abc:').toString('base64')}`
		);
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

	it('creates a refund with the expected envelope', async () => {
		const fetchMock = mockFetchOnce(200, {
			data: {
				id: 'ref_1',
				type: 'refund',
				attributes: {
					amount: 500,
					currency: 'PHP',
					payment_id: 'pay_1',
					reason: 'requested_by_customer',
					notes: 'Guest cancelled',
					status: 'pending'
				}
			}
		});
		const client = new PayMongoClient({ secretKey: 'sk_test_abc' });
		const refund = await client.createRefund({
			paymentId: 'pay_1',
			amount: 500,
			reason: 'requested_by_customer',
			notes: 'Guest cancelled'
		});

		expect(refund.id).toBe('ref_1');
		expect(refund.attributes.status).toBe('pending');
		const [url, init] = fetchMock.mock.calls[0]!;
		expect(url).toBe('https://api.paymongo.com/v1/refunds');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({
			data: {
				attributes: {
					amount: 500,
					payment_id: 'pay_1',
					reason: 'requested_by_customer',
					notes: 'Guest cancelled'
				}
			}
		});
	});

	it('creates a QR Ph refund against the separate refunds-api host', async () => {
		const fetchMock = mockFetchOnce(200, {
			data: {
				id: 'ref_2',
				type: 'refund',
				attributes: {
					amount: 500,
					currency: 'PHP',
					payment_id: 'pay_2',
					reason: 'requested_by_customer',
					status: 'processing',
					transfer_link: 'https://transfer.paymongo.com/abc'
				}
			}
		});
		const client = new PayMongoClient({ secretKey: 'sk_test_abc' });
		const refund = await client.createQrPhRefund({
			paymentId: 'pay_2',
			amount: 500,
			reason: 'requested_by_customer'
		});

		expect(refund.attributes.status).toBe('processing');
		expect(refund.attributes.transfer_link).toBe('https://transfer.paymongo.com/abc');
		const [url] = fetchMock.mock.calls[0]!;
		expect(url).toBe('https://refunds-api.paymongo.com/v1/refunds');
	});

	it('recovers a failed-status refund resource from a non-2xx response instead of throwing', async () => {
		mockFetchOnce(422, {
			data: {
				id: 'ref_3',
				type: 'refund',
				attributes: {
					amount: 500,
					currency: 'PHP',
					payment_id: 'pay_3',
					reason: 'requested_by_customer',
					status: 'failed'
				}
			}
		});
		const client = new PayMongoClient({ secretKey: 'sk_test_abc' });
		const refund = await client.createQrPhRefund({
			paymentId: 'pay_3',
			amount: 500,
			reason: 'requested_by_customer'
		});

		expect(refund.id).toBe('ref_3');
		expect(refund.attributes.status).toBe('failed');
	});

	it('still throws for a flat rejection with no refund resource', async () => {
		mockFetchOnce(422, { errors: [{ code: 'parameter_invalid', detail: 'bad request' }] });
		const client = new PayMongoClient({ secretKey: 'sk_test_abc' });
		await expect(
			client.createRefund({ paymentId: 'pay_4', amount: 500, reason: 'requested_by_customer' })
		).rejects.toBeInstanceOf(PayMongoError);
	});
});
