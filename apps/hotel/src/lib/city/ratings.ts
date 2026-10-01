/**
 * City ratings roll-up — pure shaping. Ratings are the mean of APPROVED guest reviews (the same rule the
 * public register uses), by review submission date within the chosen range. The moderation backlog is a
 * current-state figure (reviews pending right now), independent of the range. Hotels' own staff approve
 * reviews; the city only observes. DB access lives in `lib/server/city/ratings.ts`.
 */

/** A hotel needs at least this many approved reviews to be ranked among the "established" ones. */
export const MIN_REVIEWS_FOR_RANK = 5;

export const STARS = [5, 4, 3, 2, 1] as const;

/** Approved reviews of one hotel with one rating value, in range. */
export type RatingRow = { hotelId: string; rating: number; count: number };
/** Reviews awaiting approval at one hotel, with the submission date of the oldest. */
export type PendingRow = { hotelId: string; count: number; oldest: string };

/** Counts for 1★..5★, index 0 = one star. */
export type Distribution = [number, number, number, number, number];

export type HotelRating = {
	id: string;
	name: string;
	slug: string;
	count: number;
	/** Mean rounded to 1 decimal; null = no approved reviews in range (never shown as 0). */
	avg: number | null;
	distribution: Distribution;
	pending: number;
	/** `YYYY-MM-DD` of the oldest pending review, or null. */
	oldestPending: string | null;
	/** Fewer than MIN_REVIEWS_FOR_RANK approved reviews — shown, but flagged as a small sample. */
	fewReviews: boolean;
};

export type RatingsReport = {
	hotels: HotelRating[];
	totals: {
		count: number;
		avg: number | null;
		distribution: Distribution;
		pending: number;
		hotelsRated: number;
	};
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const emptyDist = (): Distribution => [0, 0, 0, 0, 0];

export function buildRatingsReport(
	hotels: { id: string; name: string; slug: string }[],
	ratings: RatingRow[],
	pending: PendingRow[]
): RatingsReport {
	const dist = new Map<string, Distribution>(hotels.map((h) => [h.id, emptyDist()]));
	for (const r of ratings) {
		const d = dist.get(r.hotelId);
		if (!d || !Number.isInteger(r.rating) || r.rating < 1 || r.rating > 5) continue;
		d[r.rating - 1]! += r.count;
	}
	const pend = new Map(pending.map((p) => [p.hotelId, p]));

	const list: HotelRating[] = hotels.map((h) => {
		const d = dist.get(h.id)!;
		const count = d.reduce((a, b) => a + b, 0);
		const sum = d.reduce((a, n, i) => a + n * (i + 1), 0);
		const p = pend.get(h.id);
		return {
			id: h.id,
			name: h.name,
			slug: h.slug,
			count,
			avg: count > 0 ? round1(sum / count) : null,
			distribution: d,
			pending: p?.count ?? 0,
			oldestPending: p?.oldest ?? null,
			fewReviews: count > 0 && count < MIN_REVIEWS_FOR_RANK
		};
	});

	// Established hotels first by rating, then small samples, then unrated; ties → more reviews, then A–Z.
	const tier = (h: HotelRating) => (h.count === 0 ? 2 : h.fewReviews ? 1 : 0);
	list.sort(
		(a, b) =>
			tier(a) - tier(b) ||
			(b.avg ?? 0) - (a.avg ?? 0) ||
			b.count - a.count ||
			a.name.localeCompare(b.name)
	);

	const total = emptyDist();
	for (const h of list) h.distribution.forEach((n, i) => (total[i]! += n));
	const count = total.reduce((a, b) => a + b, 0);
	const sum = total.reduce((a, n, i) => a + n * (i + 1), 0);

	return {
		hotels: list,
		totals: {
			count,
			// Weighted by review, not a mean of hotel means.
			avg: count > 0 ? round1(sum / count) : null,
			distribution: total,
			pending: list.reduce((a, h) => a + h.pending, 0),
			hotelsRated: list.filter((h) => h.count > 0).length
		}
	};
}

export function ratingsCsvRows(report: RatingsReport): { headers: string[]; rows: (string | number)[][] } {
	return {
		headers: ['Hotel', 'Slug', 'Average rating', 'Approved reviews', '5 star', '4 star', '3 star', '2 star', '1 star', 'Pending review'],
		rows: [
			...report.hotels.map((h) => [
				h.name,
				h.slug,
				h.avg ?? '',
				h.count,
				...[...h.distribution].reverse(),
				h.pending
			]),
			[
				'All hotels',
				'',
				report.totals.avg ?? '',
				report.totals.count,
				...[...report.totals.distribution].reverse(),
				report.totals.pending
			]
		]
	};
}
