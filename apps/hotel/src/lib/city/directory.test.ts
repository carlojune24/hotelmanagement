import { describe, expect, it } from 'vitest';
import { buildDirectory, overallRating, parseSort, type DirectoryHotel } from './directory';

const h = (id: string, name: string, city: string | null = null): DirectoryHotel => ({
	id,
	slug: id,
	name,
	city,
	photoUrl: null
});

describe('buildDirectory', () => {
	const hotels = [h('a', 'Alpha Inn', 'Davao'), h('b', 'Bravo Resort'), h('c', 'Charlie Lodge')];
	const ratings = new Map([
		['a', { avg: 4.04, count: 10 }],
		['b', { avg: 4.5, count: 2 }]
	]);
	const rooms = new Map([['a', 12]]);

	it('ranks rated hotels by rating, unrated last, never showing 0', () => {
		const rows = buildDirectory(hotels, ratings, rooms, { q: '', sort: 'rating' });
		expect(rows.map((r) => r.id)).toEqual(['b', 'a', 'c']);
		expect(rows[1]!.rating).toBe(4);
		expect(rows[2]!.rating).toBeNull();
		expect(rows[2]!.rooms).toBe(0);
	});

	it('sorts by name and filters by name or city', () => {
		expect(buildDirectory(hotels, ratings, rooms, { q: '', sort: 'name' }).map((r) => r.id)).toEqual(['a', 'b', 'c']);
		expect(buildDirectory(hotels, ratings, rooms, { q: 'davao', sort: 'rating' }).map((r) => r.id)).toEqual(['a']);
	});

	it('weights the overall rating by review count', () => {
		const rows = buildDirectory(hotels, ratings, rooms, { q: '', sort: 'rating' });
		expect(overallRating(rows)).toEqual({ avg: 4.1, count: 12 });
		expect(overallRating([])).toEqual({ avg: null, count: 0 });
	});

	it('defaults the sort param to rating', () => {
		expect(parseSort(null)).toBe('rating');
		expect(parseSort('name')).toBe('name');
		expect(parseSort('junk')).toBe('rating');
	});
});
