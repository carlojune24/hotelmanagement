import { error } from '@sveltejs/kit';
import { getReservationForGuest } from '$lib/server/dining-reservations';
import type { RequestHandler } from './$types';

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** The guest's reservation as a one-event calendar file. Needs the same token as the ticket. */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	const token = url.searchParams.get('t');
	if (!token) error(404, 'Not found');
	const r = await getReservationForGuest(locals.hotel!.id, locals.hotel!.timezone, params.code, token);
	if (!r || r.status === 'cancelled') error(404, 'Not found');

	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//mmhotel//dining//EN',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		'BEGIN:VEVENT',
		`UID:${r.id}@${locals.hotel!.slug}`,
		`DTSTAMP:${stamp(new Date())}`,
		`DTSTART:${stamp(r.startsAt)}`,
		`DTEND:${stamp(r.endsAt)}`,
		`SUMMARY:${esc(`Table at ${r.venueTitle} (${locals.hotel!.name})`)}`,
		`DESCRIPTION:${esc(`Reservation ${r.code} for ${r.partySize}`)}`,
		`LOCATION:${esc(`${r.venueTitle}, ${locals.hotel!.name}`)}`,
		'END:VEVENT',
		'END:VCALENDAR'
	];
	return new Response(lines.join('\r\n') + '\r\n', {
		headers: {
			'content-type': 'text/calendar; charset=utf-8',
			'content-disposition': `attachment; filename="${r.code}.ics"`,
			'cache-control': 'no-store'
		}
	});
};
