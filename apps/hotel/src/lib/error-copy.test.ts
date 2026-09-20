import { describe, expect, it } from 'vitest';
import { errorCopy } from './error-copy';

describe('errorCopy', () => {
	it('replaces SvelteKit bare defaults but keeps written messages', () => {
		expect(errorCopy(404, 'Not Found').body).toBe('The link may be old or mistyped.');
		expect(errorCopy(404, 'Booking not found').body).toBe('Booking not found');
	});

	it('403 and 401 share the access copy', () => {
		expect(errorCopy(403, 'Forbidden').title).toBe(errorCopy(401, undefined).title);
		expect(errorCopy(403, 'This document link is invalid.').body).toContain('document link');
	});

	it('never echoes a 5xx message, and marks it retryable', () => {
		const c = errorCopy(500, 'relation "bookings" does not exist');
		expect(c.body).not.toContain('relation');
		expect(c.retryable).toBe(true);
	});

	it('4xx other than 429 is not retryable', () => {
		expect(errorCopy(409, 'Room taken').retryable).toBe(false);
		expect(errorCopy(429, undefined).retryable).toBe(true);
	});
});
