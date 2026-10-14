import { requireCap } from '$lib/server/auth/rbac';
import { AUDIT_EXPORT_MAX, exportAuditLog, parseAuditFilter } from '$lib/server/audit';
import { getBirSettings } from '$lib/server/finance/documents';
import { buildAuditRegisterDoc } from '$lib/audit-register-doc';
import { actionLabel } from '$lib/audit-labels';
import { localParts } from '$lib/dining-slots';
import type { PageServerLoad } from './$types';

/** The filtered Audit log as a printable A4 register. Hotel admins only (it carries IPs). */
export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'hotel:admin');
	const hotel = locals.hotel!;
	const filter = parseAuditFilter(url.searchParams);
	const [{ entries, truncated }, bir] = await Promise.all([exportAuditLog(hotel.id, filter, hotel.timezone), getBirSettings(hotel.id)]);
	const { date, time } = localParts(new Date(), hotel.timezone);

	const filters = [
		filter.action ? `action: ${actionLabel(filter.action)}` : null,
		filter.actor ? `actor: ${filter.actor.startsWith('kind:') ? filter.actor.slice(5) : (entries.find((e) => e.actorUserId === filter.actor)?.actorLabel?.split(' <')[0] ?? filter.actor)}` : null,
		filter.entityType ? `type: ${filter.entityType.replace(/_/g, ' ')}` : null,
		filter.q ? `search: ${filter.q}` : null
	].filter((x): x is string => !!x);

	return {
		doc: buildAuditRegisterDoc(entries, {
			timezone: hotel.timezone,
			period: `${filter.from ?? 'start'} to ${filter.to ?? 'today'}`,
			filters,
			truncatedAt: truncated ? AUDIT_EXPORT_MAX : null
		}),
		hotelName: hotel.name,
		hotelTin: bir?.tin ?? null,
		printedAt: `${date} ${time}`,
		preparedBy: locals.user?.name ?? ''
	};
};
