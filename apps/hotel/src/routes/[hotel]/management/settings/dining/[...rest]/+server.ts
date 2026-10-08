import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Dining settings moved to the top-level Dining area — keep old bookmarks working.
export const GET: RequestHandler = ({ params }) => {
	const rest = params.rest ? `/${params.rest}` : '';
	redirect(308, `/${params.hotel}/management/dining/settings${rest}`);
};
