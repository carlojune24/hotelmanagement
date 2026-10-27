import type { Reroute } from '@sveltejs/kit';
import { RESERVED_PREFIXES } from '$lib/slug';

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { slug: string | null; expiresAt: number }>();

/**
 * Lets a client reach their hotel at their own domain (`mmhotel.com/`) instead of the
 * platform's `/{slug}/…` path — invisibly to the browser, which keeps showing the custom domain.
 * A hostname with no mapping, including the platform's own domain, falls through untouched.
 *
 * `reroute` must live in this universal hooks file (SvelteKit ignores it in `hooks.server.ts`), so it
 * can't touch the DB: it asks `/api/hotel-domain`, cached per hostname for a minute. That endpoint is
 * under a reserved prefix, which is also what stops the lookup from rerouting itself.
 *
 * `reroute` only affects route matching; `event.url` keeps the original URL, so tenant resolution in
 * `hooks.server.ts` reads `event.params.hotel`, never the pathname.
 */
export const reroute: Reroute = async ({ url, fetch }) => {
	const [firstSegment] = url.pathname.split('/').filter(Boolean);
	// A reserved top-level path (assets, /api, /admin, /auth, …) never belongs to a hotel.
	if (firstSegment && RESERVED_PREFIXES.has(firstSegment)) return url.pathname;

	const slug = await slugForHostname(url.hostname, fetch);
	// No mapping, or the path is already slug-prefixed (the app's own links still carry the slug).
	if (!slug || firstSegment === slug) return url.pathname;

	return url.pathname === '/' ? `/${slug}` : `/${slug}${url.pathname}`;
};

async function slugForHostname(hostname: string, fetch: typeof globalThis.fetch): Promise<string | null> {
	const hit = cache.get(hostname);
	if (hit && hit.expiresAt > Date.now()) return hit.slug;
	try {
		const res = await fetch(`/api/hotel-domain?host=${encodeURIComponent(hostname)}`);
		if (!res.ok) return null;
		const { slug } = (await res.json()) as { slug: string | null };
		cache.set(hostname, { slug, expiresAt: Date.now() + CACHE_TTL_MS });
		return slug;
	} catch {
		return null; // shortcut: a failed lookup isn't cached, so the next request retries; fine at this traffic
	}
}
