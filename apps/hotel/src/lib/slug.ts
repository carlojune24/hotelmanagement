/** Pure hotel-slug rules — safe on client and server, no DB. */

/**
 * First-path-segment names that are NOT hotel slugs. Keep in sync with the route
 * tree. A hotel can never be created with one of these slugs.
 */
export const RESERVED_PREFIXES = new Set([
	'admin',
	'group',
	'auth',
	'api',
	'webhooks',
	'uploads',
	'_app',
	'assets',
	'favicon.svg',
	'health'
]);

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export function isValidSlug(slug: string): boolean {
	return SLUG_RE.test(slug) && !RESERVED_PREFIXES.has(slug);
}

export function slugError(slug: string): string | null {
	if (RESERVED_PREFIXES.has(slug)) return `"${slug}" is a reserved word`;
	if (!SLUG_RE.test(slug))
		return 'Use 3–40 lowercase letters, numbers, and hyphens; must start and end alphanumeric';
	return null;
}
