import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { diningItems } from '$lib/server/db/schema/index';
import { loadVenueMenu } from '$lib/server/dining-menu';
import { OrderError } from '$lib/server/dining-orders';
import { loadOnlineOrderingConfig, placeOnlineOrder, startDiningCheckout } from '$lib/server/dining-online';
import { getReservationForGuest } from '$lib/server/dining-reservations';
import { FinanceError } from '$lib/server/finance/shared';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const hotelId = locals.hotel!.id;
	const timezone = locals.hotel!.timezone;

	const candidates = await db
		.select({ id: diningItems.id, title: diningItems.title })
		.from(diningItems)
		.where(and(eq(diningItems.hotelId, hotelId), eq(diningItems.isActive, true), eq(diningItems.onlineOrdersEnabled, true)))
		.orderBy(asc(diningItems.sortOrder), asc(diningItems.title));

	// Only venues that are really open for ordering (hours set, a way to pay).
	const venues: { id: string; title: string }[] = [];
	for (const v of candidates) if ((await loadOnlineOrderingConfig(hotelId, v.id))?.enabled) venues.push(v);
	if (venues.length === 0) error(404, 'Online ordering is not available.');

	// A pre-order arrives from the guest's own reservation ticket and is tied to that venue.
	const resCode = url.searchParams.get('reservation');
	const resToken = url.searchParams.get('t');
	let reservation: { code: string; token: string; venueTitle: string; local: { date: string; time: string }; startsAt: string } | null = null;
	let venue = venues.find((v) => v.id === url.searchParams.get('venue')) ?? venues[0]!;
	if (resCode && resToken) {
		const r = await getReservationForGuest(hotelId, timezone, resCode, resToken);
		if (r && (r.status === 'confirmed' || r.status === 'pending')) {
			const match = venues.find((v) => v.id === r.venueId);
			if (match) {
				venue = match;
				reservation = { code: r.code, token: resToken, venueTitle: r.venueTitle, local: r.local, startsAt: r.startsAt.toISOString() };
			}
		}
	}

	const cfg = (await loadOnlineOrderingConfig(hotelId, venue.id))!;
	const menu = await loadVenueMenu(hotelId, venue.id);

	return {
		venues,
		venue,
		reservation,
		cfg: {
			orderOpen: cfg.orderOpen!,
			orderClose: cfg.orderClose!,
			prepMinutes: cfg.prepMinutes,
			pickupNote: cfg.pickupNote,
			canPayOnline: cfg.canPayOnline,
			canPayAtVenue: cfg.canPayAtVenue
		},
		timezone,
		nowIso: new Date().toISOString(),
		menu: {
			categories: menu.categories.map((c) => ({ id: c.id, name: c.name })),
			items: menu.items
				.filter((i) => i.isActive)
				.map((i) => ({
					id: i.id,
					name: i.name,
					description: i.description,
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
		}
	};
};

const lineSchema = z.object({
	menuItemId: z.string().uuid(),
	quantity: z.number().int().min(1).max(50),
	remarks: z.string().max(300).optional(),
	addonIds: z.array(z.string().uuid()).max(30).optional()
});

const placeSchema = z.object({
	venueId: z.string().uuid(),
	orderType: z.enum(['takeaway', 'pre_order']),
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
	time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
	reservation: z.object({ code: z.string().min(3).max(20), token: z.string().min(10).max(60) }).optional(),
	guestName: z.string().trim().min(1, 'Please enter your name.').max(120),
	guestPhone: z.string().trim().min(5, 'Please enter a mobile number we can reach.').max(40),
	guestEmail: z.union([z.literal(''), z.string().trim().email('That email address looks off.')]).optional(),
	remarks: z.string().trim().max(500).optional(),
	payMode: z.enum(['online', 'venue']),
	lines: z.array(lineSchema).min(1, 'Add at least one item to your order.').max(40),
	website: z.string().max(200).optional()
});

export const actions: Actions = {
	place: async (event) => {
		const { locals, request, params, url } = event;
		const hotel = locals.hotel!;
		const raw = String((await request.formData()).get('payload') ?? '');
		let json: unknown;
		try {
			json = JSON.parse(raw);
		} catch {
			return fail(400, { error: 'Your order could not be read. Please try again.' });
		}
		const parsed = placeSchema.safeParse(json);
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Please check your order and try again.' });
		const d = parsed.data;
		// Honeypot: a real visitor never fills this field.
		if (d.website) return fail(400, { error: 'Something went wrong. Please try again.' });

		let placed;
		try {
			placed = await placeOnlineOrder({
				hotelId: hotel.id,
				venueId: d.venueId,
				timezone: hotel.timezone,
				orderType: d.orderType,
				date: d.date,
				time: d.time,
				reservation: d.reservation,
				guestName: d.guestName,
				guestPhone: d.guestPhone,
				guestEmail: d.guestEmail || null,
				remarks: d.remarks || null,
				payMode: d.payMode,
				lines: d.lines
			});
		} catch (e) {
			if (e instanceof OrderError || e instanceof FinanceError) return fail(409, { error: e.message });
			throw e;
		}

		const track = `/${params.hotel}/dining/order/${placed.code}?t=${placed.accessToken}`;
		if (placed.status === 'new') redirect(303, track); // pay at the restaurant: already in the kitchen

		try {
			const { checkoutUrl } = await startDiningCheckout({
				hotelId: hotel.id,
				orderId: placed.id,
				hotelName: hotel.name,
				successUrl: `${url.origin}${track}&paid=1`,
				cancelUrl: `${url.origin}${track}&cancelled=1`
			});
			redirect(303, checkoutUrl);
		} catch (e) {
			if (e && typeof e === 'object' && 'status' in e && 'location' in e) throw e; // the redirect above
			console.error('dining checkout could not be started', placed.code, e);
			// The order exists and is waiting for payment: the order page offers "Pay now" to try again.
			redirect(303, `${track}&payerror=1`);
		}
	}
};
