import type { CheckoutSession, CheckoutSessionCreateAttributes, Refund, Webhook } from './types';

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
		options: {
			method?: 'GET' | 'POST' | 'PATCH' | 'PUT';
			body?: unknown;
			/** Override the client's own base URL — QR Ph refunds run on an entirely
			 *  separate host (`refunds-api.paymongo.com`), not `api.paymongo.com`. */
			baseUrl?: string;
		} = {}
	): Promise<T> {
		const auth = Buffer.from(`${this.#secretKey}:`).toString('base64');
		const res = await fetch(`${options.baseUrl ?? this.#baseUrl}${path}`, {
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
		const res = await this.request<{ data: CheckoutSession }>(`/checkout_sessions/${id}/expire`, {
			method: 'POST'
		});
		return res.data;
	}

	// ---- Refunds ------------------------------------------------------------

	static readonly QR_PH_REFUNDS_BASE_URL = 'https://refunds-api.paymongo.com/v1';

	/**
	 * A refund create call can come back non-2xx (observed: HTTP 422 for a QR Ph
	 * refund) while the body still carries a real, already-`id`'d refund resource
	 * whose own `attributes.status` is simply `"failed"` — that's a materially
	 * different case from a flat rejection (no resource at all, just an `errors`
	 * array, e.g. an unrefundable payment or a bad amount): a resource was
	 * created, PayMongo just couldn't complete it. Both `createRefund` and
	 * `createQrPhRefund` recover that resource here instead of losing it to a
	 * generic thrown error, so the caller always gets a real `Refund` — including
	 * its id, for tracing — and only ever throws for a genuine flat rejection.
	 */
	private async postRefund(baseUrl: string | undefined, body: unknown): Promise<Refund> {
		try {
			const res = await this.request<{ data: Refund }>('/refunds', {
				method: 'POST',
				baseUrl,
				body
			});
			return res.data;
		} catch (e) {
			if (e instanceof PayMongoError) {
				const payload = e.payload as { data?: Refund } | null;
				if (payload?.data?.id && payload.data.type === 'refund') return payload.data;
			}
			throw e;
		}
	}

	/** `amount` in centavos, capped by the origin payment's own amount minus any
	 *  refunds already issued against it — PayMongo rejects an over-refund.
	 *  Throws (code `parameter_invalid`) for a QR Ph-sourced payment — use
	 *  `createQrPhRefund` for those instead; callers can't know a payment's
	 *  source in advance, so the standard pattern is try this first and fall
	 *  back on that specific rejection. */
	async createRefund(params: {
		paymentId: string;
		amount: number;
		reason: 'duplicate' | 'fraudulent' | 'requested_by_customer' | 'others';
		notes?: string;
	}): Promise<Refund> {
		return this.postRefund(undefined, {
			data: {
				attributes: {
					amount: params.amount,
					payment_id: params.paymentId,
					reason: params.reason,
					notes: params.notes
				}
			}
		});
	}

	/**
	 * QR Ph payments can't be refunded through the standard `/refunds` endpoint
	 * (PayMongo rejects it: "Refunds are not allowed for payments with source
	 * type qrph") — they run on an entirely separate API host and, unlike a
	 * standard refund, don't move money automatically: the response carries a
	 * `transfer_link` the *guest* must open and claim, and `status` starts at
	 * `processing`, passing through `refunding` before `succeeded`/`failed`.
	 */
	async createQrPhRefund(params: {
		paymentId: string;
		amount: number;
		reason: 'duplicate' | 'fraudulent' | 'requested_by_customer' | 'others';
		notes?: string;
	}): Promise<Refund> {
		return this.postRefund(PayMongoClient.QR_PH_REFUNDS_BASE_URL, {
			data: {
				attributes: {
					amount: params.amount,
					payment_id: params.paymentId,
					reason: params.reason,
					notes: params.notes
				}
			}
		});
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

	async updateWebhook(id: string, params: { url?: string; events?: string[] }): Promise<Webhook> {
		const res = await this.request<{ data: Webhook }>(`/webhooks/${id}`, {
			method: 'PUT',
			body: { data: { attributes: params } }
		});
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
