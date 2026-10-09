import { error } from '@sveltejs/kit';
import { QR_COOKIE, listMyQrOrders, parseRemembered, resolveQrTable } from '$lib/server/dining-qr';
import type { LayoutServerLoad } from './$types';

/**
 * Everything both table pages share: which table this is, and the orders this guest has placed at it.
 * The top bar's "My orders" badge and the My orders page read the same data, and one 10-second poll
 * (`app:dining-qr`) keeps them both current. The menu is loaded by the menu page alone, so the poll
 * never re-fetches it.
 */
export const load: LayoutServerLoad = async ({ locals, params, cookies, depends }) => {
	depends('app:dining-qr');
	const hotelId = locals.hotel!.id;
	const table = await resolveQrTable(hotelId, params.token);
	if (!table) error(404, 'This table code is not valid any more. Please ask your waiter for help.');

	const mine = await listMyQrOrders(hotelId, table.id, parseRemembered(cookies.get(QR_COOKIE)));
	return {
		table: { name: table.name, areaName: table.areaName, venueTitle: table.venueTitle },
		...mine
	};
};
