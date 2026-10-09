import { fail } from '@sveltejs/kit';
import { OrderError } from '$lib/server/dining-orders';
import { QR_COOKIE, cancelMyQrOrder, parseRemembered, requestMyBill, resolveQrTable } from '$lib/server/dining-qr';
import type { Actions } from './$types';

// The orders themselves come from the layout (`+layout.server.ts`), which the top bar's badge shares.

export const actions: Actions = {
	/** Cancels one of this guest's own orders while the restaurant has not confirmed it. */
	cancel: async ({ locals, params, cookies, request }) => {
		const hotelId = locals.hotel!.id;
		const table = await resolveQrTable(hotelId, params.token);
		if (!table) return fail(404, { error: 'This table code is not valid any more.' });
		const code = String((await request.formData()).get('code') ?? '');
		try {
			await cancelMyQrOrder({ hotelId, tableId: table.id, remembered: parseRemembered(cookies.get(QR_COOKIE)), code });
			return { ok: 'Your order was cancelled.' };
		} catch (e) {
			if (e instanceof OrderError) return fail(400, { error: e.message });
			throw e;
		}
	},

	/** Tells the waiter this table would like the bill. */
	bill: async ({ locals, params, cookies }) => {
		const hotelId = locals.hotel!.id;
		const table = await resolveQrTable(hotelId, params.token);
		if (!table) return fail(404, { error: 'This table code is not valid any more.' });
		try {
			await requestMyBill({ hotelId, tableId: table.id, remembered: parseRemembered(cookies.get(QR_COOKIE)) });
			return { ok: 'We have let your waiter know. They will bring the bill to your table.' };
		} catch (e) {
			if (e instanceof OrderError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
