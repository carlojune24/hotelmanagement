import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { loadVenueMenu } from '$lib/server/dining-menu';
import { OrderError } from '$lib/server/dining-orders';
import {
	QR_COOKIE,
	cancelMyQrOrder,
	listMyQrOrders,
	parseRemembered,
	placeQrOrder,
	requestMyBill,
	resolveQrTable,
	serializeRemembered
} from '$lib/server/dining-qr';
import { qrOrderByIp, qrOrderByTable } from '$lib/server/auth/rate-limit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, cookies, depends }) => {
	depends('app:dining-qr');
	const hotelId = locals.hotel!.id;
	const table = await resolveQrTable(hotelId, params.token);
	if (!table) error(404, 'This table code is not valid any more. Please ask your waiter for help.');

	const menu = await loadVenueMenu(hotelId, table.venueId);
	const mine = await listMyQrOrders(hotelId, table.id, parseRemembered(cookies.get(QR_COOKIE)));

	return {
		table: { name: table.name, areaName: table.areaName, venueTitle: table.venueTitle },
		menu: {
			categories: menu.categories.map((c) => ({ id: c.id, name: c.name })),
			items: menu.items
				.filter((i) => i.isActive)
				.map((i) => ({
					id: i.id,
					name: i.name,
					description: i.description,
					imageUrl: i.imageUrl,
					priceCentavos: i.priceCentavos,
					isAvailable: i.isAvailable,
					categoryId: i.categoryId,
					addonGroupIds: i.addonGroupIds
				})),
			groups: menu.groups.map((g) => ({
				id: g.id,
				name: g.name,
				minChoices: g.minChoices,
				maxChoices: g.maxChoices,
				addons: g.addons.map((a) => ({ id: a.id, name: a.name, priceCentavos: a.priceCentavos, isAvailable: a.isAvailable }))
			}))
		},
		...mine,
		nowIso: new Date().toISOString()
	};
};

const lineSchema = z.object({
	menuItemId: z.string().uuid(),
	quantity: z.number().int().min(1).max(50),
	remarks: z.string().max(300).optional(),
	addonIds: z.array(z.string().uuid()).max(30).optional()
});

const placeSchema = z.object({
	guestName: z.string().trim().max(60).optional(),
	remarks: z.string().trim().max(500).optional(),
	lines: z.array(lineSchema).min(1, 'Add at least one item to your order.').max(40),
	website: z.string().max(200).optional()
});

const cookieOpts = { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 12 * 3600 } as const;

export const actions: Actions = {
	/** Sends a round to the restaurant. It waits for a waiter to accept it. */
	place: async (event) => {
		const { locals, request, params, cookies } = event;
		const hotelId = locals.hotel!.id;
		const table = await resolveQrTable(hotelId, params.token);
		if (!table) return fail(404, { error: 'This table code is not valid any more. Please ask your waiter for help.' });

		const ip = event.getClientAddress();
		const wait = Math.max(qrOrderByTable.retryAfter(params.token), qrOrderByIp.retryAfter(ip));
		if (wait > 0) return fail(429, { error: 'You have sent a lot of orders in a short time. Please ask your waiter.' });

		let json: unknown;
		try {
			json = JSON.parse(String((await request.formData()).get('payload') ?? ''));
		} catch {
			return fail(400, { error: 'Your order could not be read. Please try again.' });
		}
		const parsed = placeSchema.safeParse(json);
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Please check your order and try again.' });
		const d = parsed.data;
		if (d.website) return fail(400, { error: 'Something went wrong. Please try again.' });

		qrOrderByTable.consume(params.token);
		qrOrderByIp.consume(ip);
		let placed;
		try {
			placed = await placeQrOrder({ hotelId, table, lines: d.lines, guestName: d.guestName || null, remarks: d.remarks || null });
		} catch (e) {
			if (e instanceof OrderError) return fail(409, { error: e.message });
			throw e;
		}
		const remembered = parseRemembered(cookies.get(QR_COOKIE));
		remembered.push({ code: placed.code, token: placed.accessToken });
		cookies.set(QR_COOKIE, serializeRemembered(remembered), cookieOpts);
		redirect(303, `${event.url.pathname}?sent=${placed.code}`);
	},

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
