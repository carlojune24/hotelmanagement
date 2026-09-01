import { error, type Handle } from '@sveltejs/kit';
import {
	SESSION_COOKIE,
	deleteSessionCookie,
	setSessionCookie,
	validateSessionToken
} from '$lib/server/auth/session';
import {
	RESERVED_PREFIXES,
	getMembershipRole,
	loadHotelBySlug
} from '$lib/server/tenant';

export const handle: Handle = async ({ event, resolve }) => {
	// 1. Session
	const token = event.cookies.get(SESSION_COOKIE) ?? null;
	event.locals.sessionToken = token;
	event.locals.user = null;
	event.locals.hotel = null;
	event.locals.role = null;

	if (token) {
		const session = await validateSessionToken(token);
		if (session) {
			event.locals.user = session.user;
			setSessionCookie(event, token, session.expiresAt);
		} else {
			deleteSessionCookie(event);
			event.locals.sessionToken = null;
		}
	}

	// 2. Tenant resolution — first path segment
	const [seg] = event.url.pathname.split('/').filter(Boolean);
	if (seg && !RESERVED_PREFIXES.has(seg)) {
		const hotel = await loadHotelBySlug(seg);
		if (!hotel) error(404, 'Hotel not found');

		const user = event.locals.user;
		if (hotel.status !== 'published') {
			// Drafts/archived are visible only to platform admins and members.
			const isMember = user
				? user.isPlatformAdmin || (await getMembershipRole(user.id, hotel.id)) !== null
				: false;
			if (!isMember) error(404, 'Hotel not found');
		}

		event.locals.hotel = hotel;
		if (user) event.locals.role = await getMembershipRole(user.id, hotel.id);
	}

	return resolve(event);
};
