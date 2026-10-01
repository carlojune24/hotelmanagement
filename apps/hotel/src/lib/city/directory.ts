/** Pure shaping for the public city hotel directory (root `/`). No DB access — see `+page.server.ts`. */

export type DirectorySort = 'rating' | 'name';

export type DirectoryHotel = {
	id: string;
	slug: string;
	name: string;
	city: string | null;
	photoUrl: string | null;
};

export type DirectoryRow = DirectoryHotel & {
	rooms: number;
	/** Mean of approved reviews rounded to 1 decimal; null = no approved reviews (never shown as 0). */
	rating: number | null;
	reviewCount: number;
};

export function parseSort(raw: string | null): DirectorySort {
	return raw === 'name' ? 'name' : 'rating';
}

export function buildDirectory(
	hotels: DirectoryHotel[],
	ratings: Map<string, { avg: number; count: number }>,
	roomCounts: Map<string, number>,
	opts: { q: string; sort: DirectorySort }
): DirectoryRow[] {
	const q = opts.q.trim().toLowerCase();
	const rows = hotels
		.filter((h) => !q || h.name.toLowerCase().includes(q) || (h.city ?? '').toLowerCase().includes(q))
		.map<DirectoryRow>((h) => {
			const r = ratings.get(h.id);
			return {
				...h,
				rooms: roomCounts.get(h.id) ?? 0,
				rating: r && r.count > 0 ? Math.round(r.avg * 10) / 10 : null,
				reviewCount: r?.count ?? 0
			};
		});

	const byName = (a: DirectoryRow, b: DirectoryRow) => a.name.localeCompare(b.name);
	if (opts.sort === 'name') return rows.sort(byName);
	// Rated hotels first (higher rating, then more reviews), unrated after, each group A–Z.
	return rows.sort((a, b) => {
		if ((a.rating === null) !== (b.rating === null)) return a.rating === null ? 1 : -1;
		if (a.rating !== null && b.rating !== null && a.rating !== b.rating) return b.rating - a.rating;
		if (a.reviewCount !== b.reviewCount) return b.reviewCount - a.reviewCount;
		return byName(a, b);
	});
}

/** Overall mean weighted by review count (not a mean of hotel means). */
export function overallRating(rows: DirectoryRow[]): { avg: number | null; count: number } {
	let sum = 0;
	let count = 0;
	for (const r of rows) {
		if (r.rating === null) continue;
		sum += r.rating * r.reviewCount;
		count += r.reviewCount;
	}
	return { avg: count ? Math.round((sum / count) * 10) / 10 : null, count };
}
