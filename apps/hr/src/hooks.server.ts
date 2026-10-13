import type { Handle, HandleServerError } from '@sveltejs/kit';
import {
	SESSION_COOKIE,
	deleteSessionCookie,
	setSessionCookie,
	validateSessionToken
} from '$lib/server/auth/session';
import { loadAccess } from '$lib/server/auth/access';

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(SESSION_COOKIE) ?? null;
	event.locals.sessionToken = token;
	event.locals.user = null;
	event.locals.access = null;

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

	return resolve(event);
};

/** Unexpected failures only. Mints a short reference, logs the full error against it, and hands
 *  the page a generic message so a stack trace or SQL error never leaves the server. */
export const handleError: HandleServerError = ({ error, event, status, message }) => {
	if (status < 500) return { message };
	const ref = crypto.randomUUID().slice(0, 8).toUpperCase();
	console.error(
		`[error ${ref}] ${event.request.method} ${event.url.pathname}`,
		`route=${event.route.id ?? '-'} user=${event.locals.user?.id ?? '-'}`,
		error
	);
	return { message: 'Something went wrong on our side.', ref };
};
