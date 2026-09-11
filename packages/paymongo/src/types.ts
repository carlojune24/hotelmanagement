/**
 * @mm/paymongo/types — shapes for the PayMongo resources this package touches.
 * Deliberately partial: well-known fields are typed, everything else falls
 * through the index signature rather than being exhaustively modeled.
 */

export interface PayMongoLineItem {
	amount: number;
	currency: string;
	description?: string;
	images?: string[];
	name: string;
	quantity: number;
}

export interface CheckoutSessionCreateAttributes {
	line_items: PayMongoLineItem[];
	success_url: string;
	cancel_url: string;
	payment_method_types: string[];
	billing?: { name?: string; email?: string; phone?: string };
	description?: string;
	send_email_receipt?: boolean;
	show_description?: boolean;
	show_line_items?: boolean;
	reference_number?: string;
	metadata?: Record<string, string>;
	[key: string]: unknown;
}

export interface PayMongoPayment {
	id: string;
	type: 'payment';
	attributes: {
		amount: number;
		currency: string;
		status: string;
		fee: number;
		net_amount: number;
		paid_at: number | null;
		metadata?: Record<string, string>;
		[key: string]: unknown;
	};
}

export interface CheckoutSession {
	id: string;
	type: 'checkout_session';
	attributes: {
		checkout_url: string;
		status: string;
		livemode: boolean;
		payment_method_used?: string;
		paid_at: number | null;
		metadata?: Record<string, string>;
		payments?: PayMongoPayment[];
		[key: string]: unknown;
	};
}

export interface Webhook {
	id: string;
	type: 'webhook';
	attributes: {
		url: string;
		events: string[];
		livemode: boolean;
		status: 'enabled' | 'disabled';
		secret_key?: string;
		disabled_reason?: string;
		[key: string]: unknown;
	};
}

/** The envelope PayMongo POSTs to a webhook endpoint. */
export interface PayMongoWebhookEvent<TResource = unknown> {
	data: {
		id: string;
		type: 'event';
		attributes: {
			type: string;
			livemode: boolean;
			data: TResource;
		};
	};
}
