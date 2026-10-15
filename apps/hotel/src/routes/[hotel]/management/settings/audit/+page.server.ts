import { requireCap } from '$lib/server/auth/rbac';
import {
	listAuditActions,
	listAuditActors,
	listAuditEntityTypes,
	parseAuditFilter,
	queryAuditLog
} from '$lib/server/audit';
import { auditRowHref } from '$lib/server/audit-links';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'hotel:admin');
	const hotel = locals.hotel!;

	const filter = parseAuditFilter(url.searchParams);
	const [result, entityTypes, actors, actions] = await Promise.all([
		queryAuditLog(hotel.id, filter, hotel.timezone),
		listAuditEntityTypes(hotel.id),
		listAuditActors(hotel.id),
		listAuditActions(hotel.id)
	]);

	return {
		entries: result.entries.map((e) => ({ ...e, href: auditRowHref(hotel.slug, e) })),
		total: result.total,
		page: result.page,
		pages: result.pages,
		entityTypes,
		actors,
		actions,
		filter,
		timezone: hotel.timezone
	};
};
