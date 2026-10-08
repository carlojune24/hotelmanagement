import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Orders is the working screen; the other tabs are reached from the strip.
export const load: PageServerLoad = ({ params }) => {
	redirect(302, `/${params.hotel}/management/dining/orders`);
};
