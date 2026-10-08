import { json } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { getSlotsForDate } from '$lib/server/dining-reservations';
import { zonedToUtc } from '$lib/dining-slots';
import type { RequestHandler } from './$types';

/** Bookable start times for a venue/date/party — for the staff "New reservation" sheet.
 *  Measured from the start of that day, so staff can still take a booking inside the
 *  online minimum-notice window (a phone call 20 minutes before service). */
export const GET: RequestHandler = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'dining:read');
	const venueId = url.searchParams.get('venue') ?? '';
	const date = url.searchParams.get('date') ?? '';
	const party = Number(url.searchParams.get('party'));
	if (!/^[0-9a-f-]{36}$/i.test(venueId) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(party) || party < 1) {
		return json({ slots: [] });
	}
	const timezone = locals.hotel!.timezone;
	const slots = await getSlotsForDate({
		hotelId: locals.hotel!.id,
		venueId,
		timezone,
		date,
		partySize: party,
		now: zonedToUtc(date, '00:00', timezone)
	});
	return json({ slots: slots.map((s) => ({ time: s.time, available: s.available })) });
};
