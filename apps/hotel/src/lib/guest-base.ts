/** Path prefix for a guest link: empty on the hotel's own domain (the slug is implied there), `/{slug}` elsewhere.
 *  Use `base || '/'` where the bare home path is needed. API, support, print and calendar URLs keep the slug:
 *  `reroute` doesn't rewrite reserved prefixes, so they only resolve with it. */
export function guestBase(page: {
	url: { hostname: string };
	params: Record<string, string | undefined>;
	data: Record<string, any>;
}): string {
	const hotel = page.data.hotel;
	const slug = hotel?.slug ?? page.params.hotel;
	return hotel?.customDomain && hotel.customDomain === page.url.hostname ? '' : `/${slug}`;
}
