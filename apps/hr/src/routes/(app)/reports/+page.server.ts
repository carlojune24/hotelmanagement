import { redirect } from '@sveltejs/kit';
import { REPORTS } from '$lib/reports';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	redirect(302, `/reports/${REPORTS[0].key}`);
};
