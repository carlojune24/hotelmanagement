import { error, fail, redirect } from '@sveltejs/kit';
import { OrderError } from '$lib/server/dining-orders';
import {
	cancelDiningOrderAsGuest,
	getOrderForGuest,
	postGuestMessage,
	requestDiningCancellation,
	startDiningCheckout
} from '$lib/server/dining-online';
import { FinanceError } from '$lib/server/finance/shared';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url, depends }) => {
	depends('app:dining-order');
	const token = url.searchParams.get('t');
	if (!token) error(404, 'Not found');
	const order = await getOrderForGuest(locals.hotel!.id, locals.hotel!.timezone, params.code, token);
	if (!order) error(404, 'Not found');
	return {
		order,
		token,
		// Hints from the PayMongo redirect back to this page.
		returned: { paid: url.searchParams.has('paid'), cancelled: url.searchParams.has('cancelled'), payError: url.searchParams.has('payerror') }
	};
};

const isBusinessError = (e: unknown) => e instanceof OrderError || e instanceof FinanceError;

export const actions: Actions = {
	/** Resume or restart the online payment for an order that is still waiting for it. */
	pay: async ({ locals, params, url }) => {
		const hotel = locals.hotel!;
		const token = url.searchParams.get('t') ?? '';
		const order = await getOrderForGuest(hotel.id, hotel.timezone, params.code, token);
		if (!order) return fail(404, { error: 'We could not find that order.' });
		if (!order.needsPayment) return fail(400, { error: 'This order is not waiting for payment.' });
		const track = `/${params.hotel}/dining/order/${order.code}?t=${token}`;
		try {
			const { checkoutUrl } = await startDiningCheckout({
				hotelId: hotel.id,
				orderId: order.id,
				hotelName: hotel.name,
				successUrl: `${url.origin}${track}&paid=1`,
				cancelUrl: `${url.origin}${track}&cancelled=1`
			});
			redirect(303, checkoutUrl);
		} catch (e) {
			if (e && typeof e === 'object' && 'status' in e && 'location' in e) throw e;
			if (isBusinessError(e)) return fail(400, { error: (e as Error).message });
			console.error('dining checkout could not be restarted', order.code, e);
			return fail(502, { error: 'We could not open the payment page just now. Please try again in a moment.' });
		}
	},

	cancel: async ({ locals, params, url }) => {
		try {
			await cancelDiningOrderAsGuest(locals.hotel!.id, params.code, url.searchParams.get('t') ?? '');
			return { cancelled: true };
		} catch (e) {
			if (isBusinessError(e)) return fail(400, { error: (e as Error).message });
			throw e;
		}
	},

	requestCancel: async ({ locals, params, url, request }) => {
		const note = String((await request.formData()).get('note') ?? '');
		try {
			await requestDiningCancellation(locals.hotel!.id, params.code, url.searchParams.get('t') ?? '', note);
			return { requested: true };
		} catch (e) {
			if (isBusinessError(e)) return fail(400, { error: (e as Error).message });
			throw e;
		}
	},

	message: async ({ locals, params, url, request }) => {
		const body = String((await request.formData()).get('body') ?? '');
		try {
			await postGuestMessage(locals.hotel!.id, params.code, url.searchParams.get('t') ?? '', body);
			return { sent: true };
		} catch (e) {
			if (isBusinessError(e)) return fail(400, { error: (e as Error).message });
			throw e;
		}
	}
};
