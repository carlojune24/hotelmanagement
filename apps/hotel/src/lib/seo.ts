/** Guest-page routes worth indexing; every other guest page (booking wizard, a guest's own booking) is `noindex`. */
export const INDEXABLE_ROUTES = new Set([
	'/[hotel]/(guest)',
	'/[hotel]/(guest)/contact',
	'/[hotel]/(guest)/dining',
	'/[hotel]/(guest)/rooms/[roomTypeId]',
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

/** "MMHotel" -> "MM Hotel": how people (and Google) type a camel-cased name. Null when the name has no such split. */
export function spacedName(name: string): string | null {
	const spaced = name.replace(/([A-Z]{2,})([A-Z][a-z])/g, '$1 $2').replace(/([a-z])([A-Z])/g, '$1 $2');
	return spaced === name ? null : spaced;
}

/** The brand with both spellings: "MM Hotel Tandag (MMHotel)", or just the brand when it has no spaced form. */
export function brandBothWays(name: string, city: string | null): string {
	const spaced = spacedName(name);
	return spaced ? `${brandName(spaced, city)} (${name})` : brandName(name, city);
}

/** Brand for sub-page titles: the spaced form people type ("MM Hotel Tandag") when the name has one, else the plain brand. */
export const brandTitle = (name: string, city: string | null) => brandName(spacedName(name) ?? name, city);

/** The home page's <title>. Set from the layout: the page renders async there, and a page-level <title> loses to the layout's. */
export const homeTitle = (name: string, city: string | null) => `${brandBothWays(name, city)} — Official Website & Online Booking`;

/** schema.org HotelRoom for a room-type page, serialised like `hotelJsonLd`. */
export function roomJsonLd(r: { name: string; description: string; image: string | undefined; maxOccupancy: number | null; hotelName: string; hotelUrl: string }): string {
	const ld = {
		'@context': 'https://schema.org',
		'@type': 'HotelRoom',
		name: r.name,
		...(r.description && { description: r.description }),
		...(r.image && { image: r.image }),
		...(r.maxOccupancy && { occupancy: { '@type': 'QuantitativeValue', maxValue: r.maxOccupancy } }),
		isPartOf: { '@type': 'Hotel', name: r.hotelName, url: r.hotelUrl }
	};
	return JSON.stringify(ld).replace(/</g, '\\u003c');
}

/** schema.org Hotel, serialised safely for an inline `<script>` (no `<` that could close it). */
export function hotelJsonLd(h: {
	name: string;
	alternateName?: string;
	url: string;
	city: string | null;
	address: string | undefined;
	phone: string | undefined;
	email: string | undefined;
	image: string | undefined;
	lat: number | undefined;
	lng: number | undefined;
	sameAs?: (string | null | undefined)[];
}): string {
	const ld = {
		'@context': 'https://schema.org',
		'@type': 'Hotel',
		name: h.name,
		...(h.alternateName && { alternateName: h.alternateName }),
		url: h.url,
		...(h.image && { image: h.image }),
		...(h.sameAs?.some(Boolean) && { sameAs: h.sameAs.filter(Boolean) }),
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
