import { listBrowsableRoomTypes } from '$lib/server/availability';
import { listDiningItems } from '$lib/server/dining';
import { listFunctionHalls } from '$lib/server/hall-availability';
import { loadHotelBySlug, loadHotelSlugByDomain } from '$lib/server/tenant';
import type { RequestHandler } from './$types';

/** The public, indexable pages of the hotel that owns this domain; just the landing page on the platform host. */
export const GET: RequestHandler = async ({ url }) => {
	const slug = await loadHotelSlugByDomain(url.hostname);
	const hotel = slug ? await loadHotelBySlug(slug) : null;
	const paths = ['/'];
	if (hotel?.status === 'published') {
		paths.push('/contact');
		for (const t of await listBrowsableRoomTypes(hotel.id)) paths.push(`/rooms/${t.id}`);
		if ((await listDiningItems(hotel.id)).length) paths.push('/dining');
		if ((await listFunctionHalls(hotel.id)).length) paths.push('/meetings-events');
	}
	const body = paths.map((p) => `<url><loc>${url.origin}${p}</loc></url>`).join('');
	return new Response(
		`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`,
		{ headers: { 'content-type': 'application/xml; charset=utf-8' } }
	);
};
