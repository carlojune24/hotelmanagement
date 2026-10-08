import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { diningItems } from '$lib/server/db/schema/index';
import {
	ReservationError,
	createReservation,
	getSlotsForDate,
	loadBookableVenue
} from '$lib/server/dining-reservations';
import { sendDiningReservationConfirmation } from '$lib/server/email/send-dining-reservation';
import { localParts } from '$lib/dining-slots';
import type { Actions, PageServerLoad } from './$types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
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
		slots: slots?.map((s) => ({ time: s.time, available: s.available })) ?? null
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
		// Honeypot: a real visitor never sees or fills this field.
		if (raw.website) return fail(400, { error: 'Something went wrong. Please try again.', values: keep });

		const parsed = reserveSchema.safeParse({ ...raw, guestEmail: raw.guestEmail || '' });
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Please check your details.', values: keep });
		}
		const d = parsed.data;

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
			if (d.guestEmail) void sendDiningReservationConfirmation(r.id);
			redirect(303, `/${params.hotel}/dining/reserve/${r.code}?t=${r.accessToken}`);
		} catch (e) {
			if (e instanceof ReservationError) return fail(409, { error: e.message, values: keep });
			throw e;
		}
	}
};
