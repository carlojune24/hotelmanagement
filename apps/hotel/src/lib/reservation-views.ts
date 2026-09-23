/** Tabs on the staff Reservations list and how its URL is read. Pure — shared by the loader,
 *  the query (`listReservationPage`) and the page. */

export const RESERVATION_VIEWS = [
	{ key: 'upcoming', label: 'Upcoming' },
	{ key: 'in-house', label: 'In-house' },
	{ key: 'past', label: 'Past' },
	{ key: 'cancelled', label: 'Cancelled & no-show' },
	{ key: 'all', label: 'All' }
] as const;

export type ReservationView = (typeof RESERVATION_VIEWS)[number]['key'];
export type ReservationTypeFilter = 'all' | 'room' | 'hall';

/** Line statuses (room `booking_status` + hall `hall_booking_status`) each tab shows. */
export const VIEW_STATUSES: Record<Exclude<ReservationView, 'all'>, string[]> = {
	upcoming: ['pending_payment', 'confirmed'],
	'in-house': ['checked_in'],
	past: ['checked_out', 'completed'],
	cancelled: ['cancelled', 'no_show']
};

export const RESERVATIONS_PAGE_SIZE = 25;

export interface ReservationListParams {
	view: ReservationView;
	type: ReservationTypeFilter;
	q: string;
	/** 1-based. */
	page: number;
}

/** Reads `?view=&type=&q=&page=`, falling back to safe defaults (opens on Upcoming). */
export function parseReservationParams(sp: URLSearchParams): ReservationListParams {
	const view = RESERVATION_VIEWS.some((v) => v.key === sp.get('view'))
		? (sp.get('view') as ReservationView)
		: 'upcoming';
	const t = sp.get('type');
	const type: ReservationTypeFilter = t === 'room' || t === 'hall' ? t : 'all';
	const q = (sp.get('q') ?? '').trim().slice(0, 100);
	const n = Number.parseInt(sp.get('page') ?? '1', 10);
	const page = Number.isFinite(n) && n >= 1 ? Math.min(n, 10_000) : 1;
	return { view, type, q, page };
}

/** The list URL for a changed set of params — omits defaults so links stay short. */
export function reservationListHref(
	base: string,
	params: ReservationListParams,
	change: Partial<ReservationListParams>
): string {
	const next = { ...params, ...change };
	// Any change other than paging starts again from page 1.
	if (!('page' in change)) next.page = 1;
	const sp = new URLSearchParams();
	if (next.view !== 'upcoming') sp.set('view', next.view);
	if (next.type !== 'all') sp.set('type', next.type);
	if (next.q) sp.set('q', next.q);
	if (next.page > 1) sp.set('page', String(next.page));
	const qs = sp.toString();
	return qs ? `${base}?${qs}` : base;
}
