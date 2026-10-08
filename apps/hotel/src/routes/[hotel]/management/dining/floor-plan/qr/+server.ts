import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params, url }) => {
	redirect(308, `/${params.hotel}/management/dining/floor/qr${url.search}`);
};
