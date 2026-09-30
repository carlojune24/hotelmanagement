import { error } from '@sveltejs/kit';
import { getErrorLogByRef } from '$lib/server/error-log';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const found = await getErrorLogByRef(params.ref.toUpperCase());
	if (!found) error(404, 'No error logged with that reference.');
	return found;
};
