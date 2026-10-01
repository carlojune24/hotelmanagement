import { redirect } from '@sveltejs/kit';
import {
	ERROR_LOG_PAGE_SIZE,
	getErrorLogByRef,
	listErrorLogGroups,
	listErrorLogHotels,
	listErrorLogRoutes
} from '$lib/server/error-log';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	// A ref pasted into the search box jumps straight to its detail page instead
	// of trying to render it as a list filter.
	const ref = url.searchParams.get('ref')?.trim();
	if (ref) {
		const found = await getErrorLogByRef(ref.toUpperCase());
		if (found) redirect(303, `/city/errors/${found.entry.ref}`);
	}

	const hotelId = url.searchParams.get('hotel') || undefined;
	const routeId = url.searchParams.get('route') || undefined;
	const page = Math.max(1, Number(url.searchParams.get('page')) || 1);

	const [{ groups, total }, hotels, routes] = await Promise.all([
		listErrorLogGroups({ hotelId, routeId, page }),
		listErrorLogHotels(),
		listErrorLogRoutes()
	]);

	return {
		groups,
		total,
		pageSize: ERROR_LOG_PAGE_SIZE,
		page,
		hotelId: hotelId ?? null,
		routeId: routeId ?? null,
		refNotFound: ref ? ref.toUpperCase() : null,
		hotels,
		routes
	};
};
