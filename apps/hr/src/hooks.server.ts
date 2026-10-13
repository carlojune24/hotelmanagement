import { error, type Handle, type HandleServerError } from '@sveltejs/kit';
import {
	SESSION_COOKIE,
	deleteSessionCookie,
	setSessionCookie,
	validateSessionToken
} from '$lib/server/auth/session';
import { loadAccess } from '$lib/server/auth/access';
import { loadEstablishmentBySlug } from '$lib/server/establishments';
import { canAt } from '$lib/authz';
import { RESERVED_SLUGS } from '$lib/slug';

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(SESSION_COOKIE) ?? null;
	event.locals.sessionToken = token;
	event.locals.user = null;
	event.locals.access = null;
	event.locals.establishment = null;

	if (token) {
		const session = await validateSessionToken(token);
		if (session) {
			event.locals.user = session.user;
			event.locals.access = await loadAccess(session.user.id);
			setSessionCookie(event, token, session.expiresAt);
		} else {
			deleteSessionCookie(event);
			event.locals.sessionToken = null;
		}
	}

	// Establishment resolution — only for a signed-in user, so a signed-out visitor is sent to the
	// sign-in page by the layout and can never probe which slugs exist. An establishment the user
	// has no role at is a 404, not a 403: it is not theirs to know about.
	const slug = event.params.est;
	const { user, access } = event.locals;
	if (slug && !RESERVED_SLUGS.has(slug) && user && access) {
		const est = await loadEstablishmentBySlug(slug);
		const visible =
			est && (user.isSystemAdmin || canAt(access, 'establishment:read') || est.id in access.establishments);
		if (!est || !visible) error(404, 'Not found');
		event.locals.establishment = {
			id: est.id,
			slug: est.slug,
			name: est.name,
			kind: est.kind as 'hotel' | 'business',
			timezone: est.timezone,
			config: est.config
		};
	}

	return resolve(event);
};

/** Unexpected failures only. Mints a short reference, logs the full error against it, and hands
 *  the page a generic message so a stack trace or SQL error never leaves the server. */
export const handleError: HandleServerError = ({ error: err, event, status, message }) => {
	if (status < 500) return { message };
	const ref = crypto.randomUUID().slice(0, 8).toUpperCase();
	console.error(
		`[error ${ref}] ${event.request.method} ${event.url.pathname}`,
		`route=${event.route.id ?? '-'} user=${event.locals.user?.id ?? '-'}`,
		err
	);
	return { message: 'Something went wrong on our side.', ref };
};
