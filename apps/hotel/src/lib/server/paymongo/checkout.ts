import { getPaymongoClient } from './client';
import type { Guest, Order } from '$lib/server/db/schema/index';

export interface CheckoutLineItem {
	name: string;
	description: string;
	amountCentavos: number;
}

/**
 * Creates a PayMongo hosted Checkout Session for an order's already-snapshotted
 * bill. Amounts come straight off `order.*Centavos`/the caller-built `items`
 * (one per room stay or hall reservation under the order) — never recomputed
 * here — so what the guest reviewed is exactly what they're charged.
 */
export async function createCheckoutSession(params: {
	order: Order;
	guest: Guest;
	hotelName: string;
	items: CheckoutLineItem[];
	successUrl: string;
	cancelUrl: string;
}): Promise<{ checkoutSessionId: string; checkoutUrl: string }> {
	const { order, guest, hotelName, items, successUrl, cancelUrl } = params;

	const lineItems = items.map((i) => ({
		currency: order.currency,
		amount: i.amountCentavos,
		name: i.name,
		description: i.description,
		quantity: 1
	}));
	const taxesAndFees = order.feesCentavos + order.vatCentavos;
	if (taxesAndFees > 0) {
		lineItems.push({
			currency: order.currency,
			amount: taxesAndFees,
			name: 'Taxes & fees',
			description: 'VAT and applicable hotel fees',
			quantity: 1
		});
	}

	const session = await getPaymongoClient().createCheckoutSession({
		billing: { name: guest.fullName, email: guest.email, phone: guest.phone ?? undefined },
		send_email_receipt: false,
		show_description: true,
		show_line_items: true,
		line_items: lineItems,
		payment_method_types: ['gcash', 'card', 'paymaya', 'qrph'],
		description: `${hotelName} — ${items.map((i) => i.name).join(', ')}`,
		success_url: successUrl,
		cancel_url: cancelUrl,
		metadata: { orderId: order.id }
	});

	return { checkoutSessionId: session.id, checkoutUrl: session.attributes.checkout_url };
}

/**
 * Expires a hosted Checkout Session so its `checkout_url` can no longer be paid.
 * Used when an unpaid order's inventory hold lapses (see
 * `lib/server/orders.ts`'s `expirePendingOrders`). PayMongo returns 4xx if the
 * session is already paid or expired — callers treat any failure as non-fatal.
 */
export async function expireCheckoutSession(checkoutSessionId: string): Promise<void> {
	await getPaymongoClient().expireCheckoutSession(checkoutSessionId);
}
