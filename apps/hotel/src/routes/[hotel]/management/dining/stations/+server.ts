import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Stations moved to the Kitchen section.
export const GET: RequestHandler = ({ params }) => {
	redirect(308, `/${params.hotel}/management/kitchen/stations`);
};
