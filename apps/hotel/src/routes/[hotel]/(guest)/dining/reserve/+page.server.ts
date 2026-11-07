import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { diningItems, diningMenuItems } from '$lib/server/db/schema/index';
import {
	ReservationError,
	createReservation,
	getSlotsForDate,
	loadBookableVenue
} from '$lib/server/dining-reservations';
import { loadOnlineOrderingConfig } from '$lib/server/dining-online';
import { localParts, zonedToUtc } from '$lib/dining-slots';
import type { Actions, PageServerLoad } from './$types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const addDays = (date: string, n: number) => {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
};

export const load: PageServerLoad = async ({ locals, url }) => {
	const hotelId = locals.hotel!.id;
	const timezone = locals.hotel!.timezone;

	const venues = await db
		.select({ id: diningItems.id, title: diningItems.title, tagline: diningItems.tagline })
		.from(diningItems)
		.where(
			and(
				eq(diningItems.hotelId, hotelId),
				eq(diningItems.isActive, true),
				eq(diningItems.reservationsEnabled, true)
			)
		)
		.orderBy(asc(diningItems.sortOrder), asc(diningItems.title));
	if (venues.length === 0) error(404, 'Table reservations are not available.');

	const venue = venues.find((v) => v.id === url.searchParams.get('venue')) ?? venues[0]!;
	const bookable = await loadBookableVenue(hotelId, venue.id);
	if (!bookable?.cfg) error(404, 'Table reservations are not available.');

	const today = localParts(new Date(), timezone).date;
	const maxDate = addDays(today, bookable.cfg.advanceDays);
	const rawDate = url.searchParams.get('date') ?? '';
	const date = DATE_RE.test(rawDate) && rawDate >= today && rawDate <= maxDate ? rawDate : null;
	const party = Math.min(
		bookable.partyCap,
		Math.max(1, Math.floor(Number(url.searchParams.get('party'))) || Math.min(2, bookable.partyCap))
	);

	// Booking online means pre-ordering and paying in full online; takeaway ordering need not be on.
	const ordering = await loadOnlineOrderingConfig(hotelId, venue.id);
	const orderAhead = ordering?.preOrderEnabled ?{ prepMinutes: ordering.prepMinutes } : null;
	const readyBy = Date.now() + (orderAhead?.prepMinutes ?? 0) * 60_000;

	// A dish tapped on the Dining page rides along to the pre-order step (`?dish=` on the order page).
	const rawDish = url.searchParams.get('dish') ?? '';
	const [dish] = UUID_RE.test(rawDish)
		? await db
				.select({ id: diningMenuItems.id, name: diningMenuItems.name })
				.from(diningMenuItems)
				.where(
					and(
						eq(diningMenuItems.id, rawDish),
						eq(diningMenuItems.hotelId, hotelId),
						eq(diningMenuItems.diningItemId, venue.id),
						eq(diningMenuItems.isActive, true),
						isNull(diningMenuItems.deletedAt)
					)
				)
		: [];

	const slots = date
		? await getSlotsForDate({ hotelId, venueId: venue.id, timezone, date, partySize: party })
		: null;

	return {
		venues,
		venue,
		partyCap: bookable.partyCap,
		hoursNote: `${bookable.cfg.seatingOpen}–${bookable.cfg.lastSeating}`,
		today,
		maxDate,
		date,
		party,
		orderAhead,
		dish: dish ?? null,
		// A table too soon for the kitchen to have the pre-order ready is not offered.
		slots:
			slots?.map((s) => ({ time: s.time, available: s.available && zonedToUtc(date!, s.time, timezone).getTime() > readyBy })) ?? null
	};
};

const reserveSchema = z.object({
	venue: z.string().uuid(),
	date: z.string().regex(DATE_RE),
	time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Pick a time.'),
	party: z.coerce.number().int().min(1),
	guestName: z.string().trim().min(1, 'Please enter your name.').max(120),
	guestPhone: z.string().trim().min(5, 'Please enter a mobile number we can reach.').max(40),
	guestEmail: z.union([z.literal(''), z.string().trim().email('That email address looks off.')]).optional(),
	remarks: z.string().trim().max(500).optional()
});

export const actions: Actions = {
	reserve: async ({ locals, request, params }) => {
		const hotelId = locals.hotel!.id;
		const raw = Object.fromEntries(await request.formData());
		const keep = {
			venue: String(raw.venue ?? ''),
			date: String(raw.date ?? ''),
			party: String(raw.party ?? ''),
			time: String(raw.time ?? ''),
			guestName: String(raw.guestName ?? ''),
			guestPhone: String(raw.guestPhone ?? ''),
			guestEmail: String(raw.guestEmail ?? ''),
			remarks: String(raw.remarks ?? '')
		};
		const dishParam = UUID_RE.test(String(raw.dish ?? '')) ? `&dish=${raw.dish}` : '';
		// Honeypot: a real visitor never sees or fills this field.
		if (raw.website) return fail(400, { error: 'Something went wrong. Please try again.', values: keep });

		const parsed = reserveSchema.safeParse({ ...raw, guestEmail: raw.guestEmail || '' });
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Please check your details.', values: keep });
		}
		const d = parsed.data;

		// Every online table comes with a pre-order paid in full online; the payment confirms the table.
		const ordering = await loadOnlineOrderingConfig(hotelId, d.venue);
		if (!ordering?.preOrderEnabled) {
			return fail(409, { error: 'Online reservations are not available right now. Please call us to book.', values: keep });
		}
		if (zonedToUtc(d.date, d.time, locals.hotel!.timezone).getTime() <= Date.now() + ordering.prepMinutes * 60_000) {
			return fail(409, { error: `We need at least ${ordering.prepMinutes} minutes to prepare your order. Please pick a later time.`, values: keep });
		}

		try {
			const r = await createReservation({
				hotelId,
				venueId: d.venue,
				timezone: locals.hotel!.timezone,
				date: d.date,
				time: d.time,
				partySize: d.party,
				guestName: d.guestName,
				guestPhone: d.guestPhone,
				guestEmail: d.guestEmail || null,
				remarks: d.remarks || null,
				source: 'online'
			});
			// The table is held `pending`; choosing dishes and paying for them confirms it (and sends the
			// confirmation email). Unpaid, it is released after the checkout window.
			redirect(303, `${locals.isCustomDomain ? "" : `/${params.hotel}`}/dining/order?venue=${d.venue}&reservation=${r.code}&t=${r.accessToken}${dishParam}`);
		} catch (e) {
			if (e instanceof ReservationError) return fail(409, { error: e.message, values: keep });
			throw e;
		}
	}
};
