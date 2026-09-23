import { describe, expect, it } from 'vitest';
import { parseReservationParams, reservationListHref } from './reservation-views';

const parse = (qs: string) => parseReservationParams(new URLSearchParams(qs));

describe('parseReservationParams', () => {
	it('opens on Upcoming, all types, page 1', () => {
		expect(parse('')).toEqual({ view: 'upcoming', type: 'all', q: '', page: 1 });
	});

	it('reads a valid view, type, search and page', () => {
		expect(parse('view=past&type=hall&q=%20carlo%20&page=3')).toEqual({
			view: 'past',
			type: 'hall',
			q: 'carlo',
			page: 3
		});
	});

	it('ignores junk', () => {
		expect(parse('view=nope&type=x&page=-2')).toEqual({
			view: 'upcoming',
			type: 'all',
			q: '',
			page: 1
		});
		expect(parse('page=abc').page).toBe(1);
	});
});

describe('reservationListHref', () => {
	const params = { view: 'past' as const, type: 'all' as const, q: 'carlo', page: 3 };

	it('keeps other params and resets to page 1 on a filter change', () => {
		expect(reservationListHref('/r', params, { view: 'all' })).toBe('/r?view=all&q=carlo');
	});

	it('pages without dropping filters', () => {
		expect(reservationListHref('/r', params, { page: 4 })).toBe('/r?view=past&q=carlo&page=4');
	});

	it('omits defaults', () => {
		expect(reservationListHref('/r', params, { view: 'upcoming', q: '' })).toBe('/r');
	});
});
