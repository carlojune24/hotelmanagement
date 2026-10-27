import type { RequestHandler } from './$types';

/** Per-host so the Sitemap line names the address the crawler actually used (hotel domain or platform). */
export const GET: RequestHandler = ({ url }) =>
	new Response(
		['User-agent: *', 'Disallow: /admin', 'Disallow: /auth', 'Disallow: /api', 'Disallow: /*/management', `Sitemap: ${url.origin}/sitemap.xml`, ''].join('\n'),
		{ headers: { 'content-type': 'text/plain; charset=utf-8' } }
	);
