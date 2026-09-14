import { requireCap } from '$lib/server/auth/rbac';
import { listAuditEntityTypes, listAuditLog } from '$lib/server/audit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'hotel:admin');
	const hotelId = locals.hotel!.id;

	const entityType = url.searchParams.get('entityType') || undefined;
	const [entries, entityTypes] = await Promise.all([
		listAuditLog(hotelId, { entityType }),
		listAuditEntityTypes(hotelId)
	]);

	return { entries, entityTypes, entityType: entityType ?? 'all' };
};
