import type { CheckoutSession, CheckoutSessionCreateAttributes, Webhook } from './types';

export interface PayMongoClientOptions {
	secretKey: string;
	/** Override for testing; defaults to PayMongo's production API. */
	baseUrl?: string;
}

export class PayMongoError extends Error {
	status: number;
	payload: unknown;

	constructor(status: number, payload: unknown) {
		super(`PayMongo request failed (${status}): ${JSON.stringify(payload)}`);
		this.name = 'PayMongoError';
		this.status = status;
		this.payload = payload;
	}
}

/** Thin REST client for PayMongo — auth, JSON envelopes, and the handful of
 * endpoints this package wraps (Checkout Sessions, Webhooks). Anything not
 * wrapped below is still reachable through `request()`. */
export class PayMongoClient {
	#secretKey: string;
	#baseUrl: string;

	constructor(options: PayMongoClientOptions) {
		if (!options.secretKey) throw new Error('PayMongoClient: secretKey is required');
		this.#secretKey = options.secretKey;
		this.#baseUrl = options.baseUrl ?? 'https://api.paymongo.com/v1';
	}

	/** Auth is HTTP Basic with the secret key as username, empty password. */
	async request<T = unknown>(
		path: string,
		options: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown } = {}
	): Promise<T> {
		const auth = Buffer.from(`${this.#secretKey}:`).toString('base64');
		const res = await fetch(`${this.#baseUrl}${path}`, {
			method: options.method ?? 'GET',
			headers: {
				Authorization: `Basic ${auth}`,
				'Content-Type': 'application/json',
				Accept: 'application/json'
			},
			body: options.body != null ? JSON.stringify(options.body) : undefined
		});

		const payload = await res.json().catch(() => null);
		if (!res.ok) throw new PayMongoError(res.status, payload);
		return payload as T;
	}

	// ---- Checkout Sessions ----------------------------------------------

	async createCheckoutSession(
		attributes: CheckoutSessionCreateAttributes
	): Promise<CheckoutSession> {
		const res = await this.request<{ data: CheckoutSession }>('/checkout_sessions', {
			method: 'POST',
			body: { data: { attributes } }
		});
		return res.data;
	}

	async retrieveCheckoutSession(id: string): Promise<CheckoutSession> {
		const res = await this.request<{ data: CheckoutSession }>(`/checkout_sessions/${id}`);
		return res.data;
	}

	/** PayMongo returns 4xx if the session is already paid or expired — treat
	 * any failure here as non-fatal at the call site. */
	async expireCheckoutSession(id: string): Promise<CheckoutSession> {
		const res = await this.request<{ data: CheckoutSession }>(
			`/checkout_sessions/${id}/expire`,
			{ method: 'POST' }
		);
		return res.data;
	}

	// ---- Webhooks ----------------------------------------------------------

	async createWebhook(params: { url: string; events: string[] }): Promise<Webhook> {
		const res = await this.request<{ data: Webhook }>('/webhooks', {
			method: 'POST',
			body: { data: { attributes: params } }
		});
		return res.data;
	}

	async listWebhooks(): Promise<Webhook[]> {
		const res = await this.request<{ data: Webhook[] }>('/webhooks');
		return res.data;
	}

	async retrieveWebhook(id: string): Promise<Webhook> {
		const res = await this.request<{ data: Webhook }>(`/webhooks/${id}`);
		return res.data;
	}

	async enableWebhook(id: string): Promise<Webhook> {
		const res = await this.request<{ data: Webhook }>(`/webhooks/${id}/enable`, {
			method: 'POST'
		});
		return res.data;
	}

	async disableWebhook(id: string): Promise<Webhook> {
		const res = await this.request<{ data: Webhook }>(`/webhooks/${id}/disable`, {
			method: 'POST'
		});
		return res.data;
	}
}
