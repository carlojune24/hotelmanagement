import type { HandleClientError } from '@sveltejs/kit';

/** Client-side failures (a thrown load/navigation error in the browser). Logged to the console
 *  with a short reference so it matches what the visitor sees on the error page. */
export const handleError: HandleClientError = ({ error, status, message }) => {
	if (status < 500) return { message };
	const ref = crypto.randomUUID().slice(0, 8).toUpperCase();
	console.error(`[error ${ref}]`, error);
	return { message: 'Something went wrong on our side.', ref };
};
