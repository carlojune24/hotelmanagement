import { error, type Handle, type Reroute } from '@sveltejs/kit';
import {
	SESSION_COOKIE,
	deleteSessionCookie,
	setSessionCookie,
	validateSessionToken
} from '$lib/server/auth/session';
import {
	RESERVED_PREFIXES,
	getMembershipRole,
	loadHotelBySlug,
	loadHotelSlugByDomain
} from '$lib/server/tenant';

const DOMAIN_CACHE_TTL_MS = 60_000;
const domainCache = new Map<string, { slug: string | null; expiresAt: number }>();

/**
 * hostname -> hotel slug, for a client's own custom domain (`hotels.customDomain`). Small
 * in-memory cache since `reroute` runs on every request — a newly-set/changed domain still
 * takes effect within `DOMAIN_CACHE_TTL_MS`, no restart needed.
 */
async function resolveSlugForHostname(hostname: string): Promise<string | null> {
	const cached = domainCache.get(hostname);
	if (cached && cached.expiresAt > Date.now()) return cached.slug;

	const slug = await loadHotelSlugByDomain(hostname);
	domainCache.set(hostname, { slug, expiresAt: Date.now() + DOMAIN_CACHE_TTL_MS });
	return slug;
}

/**
 * Lets a client reach their hotel at their own domain (`mmhotel.com/book`) instead of the
 * platform's `/{slug}/…` path (`platformdomain.com/mmhotel/book`) — invisibly to the browser,
 * which keeps showing the custom domain. A hostname with no mapping — including the platform's
 * own domain — falls through untouched.
 *
 * Important: `reroute` only affects route *matching* — SvelteKit sets `event.params`/`event.route`
 * from the rewritten path before `handle` runs, but `event.url` itself keeps the original,
 * unrewritten request URL throughout (confirmed against the installed SvelteKit's own
 * `respond.js`; this is *not* documented behavior to assume, it was verified directly). So tenant
 * resolution below reads `event.params.hotel` — populated correctly either way, since a normal
 * `/{slug}/…` request resolves it the exact same way via ordinary routing — never
 * `event.url.pathname`, which would silently miss every custom-domain request.
 */
export const reroute: Reroute = async ({ url }) => {
	const slug = await resolveSlugForHostname(url.hostname);
	if (!slug) return url.pathname;

	const [firstSegment] = url.pathname.split('/').filter(Boolean);
	// Leave alone: a reserved top-level path (static assets, /api, /admin, /auth, …) — those
	// never belong to a hotel and must resolve exactly as they would on the platform's own
	// domain — and a path that's already correctly slug-prefixed, which happens whenever the
	// app's own internal links (still hardcoded with the slug — see the doc comment above)
	// get clicked on the custom domain; rewriting that again would double-prefix it.
	if (firstSegment && (RESERVED_PREFIXES.has(firstSegment) || firstSegment === slug)) {
		return url.pathname;
	}

	return url.pathname === '/' ? `/${slug}` : `/${slug}${url.pathname}`;
};

export const handle: Handle = async ({ event, resolve }) => {
	// 1. Session
	const token = event.cookies.get(SESSION_COOKIE) ?? null;
	event.locals.sessionToken = token;
	event.locals.user = null;
	event.locals.hotel = null;
	event.locals.role = null;
	event.locals.isCustomDomain = false;

	if (token) {
		const session = await validateSessionToken(token);
		if (session) {
			event.locals.user = session.user;
			setSessionCookie(event, token, session.expiresAt);
		} else {
			deleteSessionCookie(event);
			event.locals.sessionToken = null;
		}
	}

	// 2. Tenant resolution — from the matched route's own [hotel] param (see the `reroute` doc
	// comment above for why this can't be derived from `event.url.pathname`). Never populated
	// for a route outside `[hotel]` (`/admin`, `/api`, …), so the `RESERVED_PREFIXES` check here
	// is defense-in-depth on top of that, not the primary gate — hotel slugs are already
	// validated against it at creation time (`lib/slug.ts`).
	const slug = event.params.hotel;
	if (slug && !RESERVED_PREFIXES.has(slug)) {
		const hotel = await loadHotelBySlug(slug);
		if (!hotel) error(404, 'Hotel not found');

		const user = event.locals.user;
		if (hotel.status !== 'published') {
			// Drafts/archived are visible only to platform admins and members.
			const isMember = user
				? user.isPlatformAdmin || (await getMembershipRole(user.id, hotel.id)) !== null
				: false;
			if (!isMember) error(404, 'Hotel not found');
		}

		event.locals.hotel = hotel;
		event.locals.isCustomDomain = event.url.hostname === hotel.customDomain;
		if (user) event.locals.role = await getMembershipRole(user.id, hotel.id);
	}

	return resolve(event);
};
