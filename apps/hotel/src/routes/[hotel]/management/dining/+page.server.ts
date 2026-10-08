import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Phase 1 ships the Menu first; Orders / Reservations / Floor plan tabs join as they land.
export const load: PageServerLoad = ({ params }) => {
	redirect(302, `/${params.hotel}/management/dining/menu`);
};
