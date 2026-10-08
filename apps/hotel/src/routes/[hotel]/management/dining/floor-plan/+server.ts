import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// "Floor plan" is now "Floor"; keep old bookmarks and links working.
export const GET: RequestHandler = ({ params, url }) => {
	redirect(308, `/${params.hotel}/management/dining/floor${url.search}`);
};
