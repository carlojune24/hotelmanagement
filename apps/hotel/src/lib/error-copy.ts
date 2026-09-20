/** Plain-language copy for the error pages (guest, staff, fallback). Pure so it's unit-tested
 *  and every surface says the same thing. Thrown `error(4xx, '…')` messages in this codebase are
 *  already written for people ("Booking not found"), so they're shown as-is; only SvelteKit's
 *  bare defaults are replaced. A 5xx never surfaces its own message — `handleError` swaps it for
 *  a generic one, and the page shows a reference ID instead. */

export interface ErrorCopy {
	title: string;
	body: string;
	/** True for a server fault the visitor may retry. */
	retryable: boolean;
}

const BARE_DEFAULTS = new Set(['Not Found', 'Forbidden', 'Unauthorized', 'Bad Request', 'Error']);

export function errorCopy(status: number, message: string | undefined): ErrorCopy {
	const custom = message && !BARE_DEFAULTS.has(message) ? message : null;

	if (status === 404) {
		return {
			title: "We can't find that page.",
			body: custom ?? 'The link may be old or mistyped.',
			retryable: false
		};
	}
	if (status === 401 || status === 403) {
		return {
			title: "You don't have access to this.",
			body: custom ?? 'Sign in with an account that has access, or go back.',
			retryable: false
		};
	}
	if (status === 429) {
		return {
			title: 'Too many requests.',
			body: custom ?? 'Wait a moment, then try again.',
			retryable: true
		};
	}
	if (status >= 500) {
		return {
			title: 'Something went wrong on our side.',
			body: 'It has been logged. Try again in a moment; if it keeps happening, quote the reference below.',
			retryable: true
		};
	}
	return {
		title: "That didn't work.",
		body: custom ?? 'Check the link or your entries and try again.',
		retryable: false
	};
}
