import { error } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { businessDateFor } from '$lib/server/finance/shared';
import { runReport } from '$lib/server/finance/report-runner';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCap(locals.user, locals.role, 'reports:read');
	const hotel = locals.hotel!;
	const result = await runReport(hotel.id, params.slug, {
		timezone: hotel.timezone,
		date: url.searchParams.get('date') || undefined,
		from: url.searchParams.get('from') || undefined,
		to: url.searchParams.get('to') || undefined
	});
	if (!result) error(404, 'Unknown report');

	const today = businessDateFor(hotel.timezone);
	return {
		slug: params.slug,
		result,
		today,
		monthStart: `${today.slice(0, 7)}-01`,
		params: {
			date: url.searchParams.get('date') || today,
			from: url.searchParams.get('from') || `${today.slice(0, 7)}-01`,
			to: url.searchParams.get('to') || today
		}
	};
};
