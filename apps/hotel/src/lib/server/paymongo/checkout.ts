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
 * here — so what the guest reviewed is exactly what they're charged. When the order carries
 * a downpayment (`amountDueNowCentavos` below the total) the session is one line for that amount.
 */
export async function createCheckoutSession(params: {
	order: Order;
	guest: Guest;
	hotelName: string;
	items: CheckoutLineItem[];
	successUrl: string;
	cancelUrl: string;
	/** The guest chose to pay the whole bill now instead of just the policy's downpayment. */
	payInFull?: boolean;
}): Promise<{ checkoutSessionId: string; checkoutUrl: string }> {
	const { order, guest, hotelName, items, successUrl, cancelUrl, payInFull } = params;

	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
	const dueNow = order.amountDueNowCentavos;
	const isDownpayment =
		!payInFull && dueNow != null && dueNow > 0 && dueNow < order.totalCentavos;

	let lineItems: Array<{
		currency: string;
		amount: number;
		name: string;
		description: string;
		quantity: number;
	}>;
	if (isDownpayment) {
		// One line for the whole downpayment: the per-line split of a partial amount would
		// be an arbitrary allocation on PayMongo's side, and the guest sees the full itemised
		// bill on our review page just before this. The rest is collected at the hotel.
		lineItems = [
			{
				currency: order.currency,
				amount: dueNow,
				name: `Downpayment — ${hotelName}`,
				description: `${peso(dueNow)} of ${peso(order.totalCentavos)} now; the remaining ${peso(order.totalCentavos - dueNow)} is paid at the hotel.`,
				quantity: 1
			}
		];
	} else {
		lineItems = items.map((i) => ({
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
