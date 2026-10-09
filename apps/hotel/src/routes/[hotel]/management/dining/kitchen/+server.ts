import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// The Kitchen is its own section now; keep wall-screen bookmarks working.
export const GET: RequestHandler = ({ params, url }) => {
	redirect(308, `/${params.hotel}/management/kitchen${url.search}`);
};
