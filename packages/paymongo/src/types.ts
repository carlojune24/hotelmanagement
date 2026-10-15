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

/** A payment as `GET /v1/payments` returns it: money in, with PayMongo's fee and the net it keeps for you. */
export interface PayMongoPaymentRecord {
	id: string;
	type: 'payment';
	attributes: {
		amount: number;
		currency: string;
		status: string;
		fee: number;
		net_amount: number;
		/** Unix seconds. `available_at` = when the funds can be paid out; `credited_at` = when PayMongo schedules the credit. */
		paid_at: number | null;
		available_at: number | null;
		credited_at: number | null;
		created_at: number;
		updated_at?: number;
		/** Null until the payment joins a payout batch. */
		payout: unknown;
		balance_transaction_id?: string | null;
		description?: string | null;
		external_reference_number?: string | null;
		livemode?: boolean;
		metadata?: Record<string, string> | null;
		/** How the guest paid: `{ id, type: 'gcash' | 'card' | 'qrph' | … }`. */
		source?: { id?: string; type?: string; [key: string]: unknown } | null;
		refunds?: unknown[];
		[key: string]: unknown;
	};
}

/** A payout as `GET /v1/payouts` returns it (flat, not wrapped in `attributes`). Amounts are centavos, dates Unix seconds. */
export interface PayMongoPayout {
	id: string;
	type?: string;
	status: string;
	amount: number;
	fee?: number;
	refund_amount?: number;
	adjustment_amount?: number;
	dispute_amount?: number;
	net_amount: number;
	currency?: string;
	description?: string | null;
	provider?: string | null;
	bank_name?: string | null;
	bank_account_name?: string | null;
	bank_account_number?: string | null;
	last_payout_transfer?: { id?: string; status?: string; reference_number?: string | null; [key: string]: unknown } | null;
	created_at: number;
	status_updated_at?: number;
	updated_at?: number;
	[key: string]: unknown;
}

/** A PayMongo wallet (Money Movement product). Only present on accounts that have one. */
export interface PayMongoWallet {
	id: string;
	type?: string;
	attributes?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface CheckoutSession {
	id: string;
	type: 'checkout_session';
	attributes: {
		checkout_url: string;
		/** NB: stays `active` even after the session has been paid. A payment is paid when `payments[]` holds one
		 *  whose own `status` is `paid`, never judge it by this field. `expired` once it can no longer be paid. */
		status: string;
		livemode: boolean;
		payment_method_used?: string;
		paid_at: number | null;
		metadata?: Record<string, string>;
		payments?: PayMongoPayment[];
		/** Expanded: the intent the guest paid through (`pi_…`) and its own status (`succeeded` when paid). */
		payment_intent?: { id: string; attributes?: { status?: string; [key: string]: unknown } } | null;
		[key: string]: unknown;
	};
}

export interface Refund {
	id: string;
	type: 'refund';
	attributes: {
		amount: number;
		currency: string;
		payment_id: string;
		reason: 'duplicate' | 'fraudulent' | 'requested_by_customer' | 'others';
		notes?: string | null;
		/** `processing`/`refunding` only occur for a QR Ph refund — a standard refund
		 *  goes straight to `pending` (accepted, not yet reflected) or `succeeded`/`failed`. */
		status: 'pending' | 'processing' | 'refunding' | 'succeeded' | 'failed';
		/** QR Ph only — the link the *guest* must open and claim to actually receive
		 *  the money; a standard refund has no equivalent manual step. */
		transfer_link?: string;
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
