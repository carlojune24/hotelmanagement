/** Top-level path segments the app owns — an establishment slug can never shadow one. */
export const RESERVED_SLUGS = new Set([
	'auth',
	'establishments',
	'users',
	'people',
	'approvals',
	'payroll',
	'remittances',
	'account',
	'print',
	'api',
	'uploads',
	'admin',
	'static',
	'_app',
	'favicon.svg',
	'robots.txt'
]);

/** `"Café del Sol!"` → `"cafe-del-sol"`. May return '' for a name with no usable characters. */
export function slugify(name: string): string {
	return name
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48);
}

/** First free slug for `name`, trying `base`, `base-2`, `base-3` … `taken` says if one is used. */
export async function uniqueSlug(
	name: string,
	taken: (slug: string) => Promise<boolean>
): Promise<string> {
	let base = slugify(name) || 'establishment';
	if (RESERVED_SLUGS.has(base)) base = `${base}-hr`;
	for (let n = 1; ; n++) {
		const candidate = n === 1 ? base : `${base}-${n}`;
		if (!(await taken(candidate))) return candidate;
	}
}
