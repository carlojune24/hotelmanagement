/** Guest-page routes worth indexing; every other guest page (booking wizard, a guest's own booking) is `noindex`. */
export const INDEXABLE_ROUTES = new Set([
	'/[hotel]/(guest)',
	'/[hotel]/(guest)/contact',
	'/[hotel]/(guest)/dining',
	'/[hotel]/(guest)/meetings-events'
]);

/** The one address a page should be known by: the hotel's own domain (slug implied) when it has one, else the platform URL. */
export function canonicalUrl(a: { origin: string; slug: string; customDomain: string | null; pathname: string }): string {
	const prefix = `/${a.slug}`;
	const rest = a.pathname === prefix ? '/' : a.pathname.startsWith(`${prefix}/`) ? a.pathname.slice(prefix.length) : a.pathname;
	if (a.customDomain) return `https://${a.customDomain}${rest}`;
	return `${a.origin}${a.pathname}`;
}

/** "MMHotel Tandag" — the name searchers type; the city is skipped if the name already has it. */
export function brandName(name: string, city: string | null): string {
	return city && !name.toLowerCase().includes(city.toLowerCase()) ? `${name} ${city}` : name;
}

/** schema.org Hotel, serialised safely for an inline `<script>` (no `<` that could close it). */
export function hotelJsonLd(h: {
	name: string;
	url: string;
	city: string | null;
	address: string | undefined;
	phone: string | undefined;
	email: string | undefined;
	image: string | undefined;
	lat: number | undefined;
	lng: number | undefined;
}): string {
	const ld = {
		'@context': 'https://schema.org',
		'@type': 'Hotel',
		name: h.name,
		url: h.url,
		...(h.image && { image: h.image }),
		...(h.phone && { telephone: h.phone }),
		...(h.email && { email: h.email }),
		...((h.address || h.city) && {
			address: {
				'@type': 'PostalAddress',
				...(h.address && { streetAddress: h.address }),
				...(h.city && { addressLocality: h.city }),
				addressCountry: 'PH'
			}
		}),
		...(h.lat !== undefined && h.lng !== undefined && { geo: { '@type': 'GeoCoordinates', latitude: h.lat, longitude: h.lng } })
	};
	return JSON.stringify(ld).replace(/</g, '\\u003c');
}
