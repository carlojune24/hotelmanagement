import { error } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { getZReadingView } from '$lib/server/finance/readings';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	const reading = await getZReadingView(locals.hotel!.id, params.zReadingId);
	if (!reading) error(404, 'Z-reading not found');
	return {
		reading,
		printedAt: new Date().toISOString().slice(0, 16).replace('T', ' ')
	};
};
