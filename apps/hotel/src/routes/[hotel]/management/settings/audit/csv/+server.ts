import { requireCap } from '$lib/server/auth/rbac';
import { AUDIT_EXPORT_MAX, exportAuditLog, parseAuditFilter } from '$lib/server/audit';
import { toCsv } from '$lib/server/finance/calc';
import { safeCell } from '$lib/server/booking-transactions-csv';
import { buildAuditRegisterDoc } from '$lib/audit-register-doc';
import { docToCsv } from '$lib/dining-report-doc';
import type { RequestHandler } from './$types';

/** The filtered Audit log as a CSV, drawn from the same document model as the printed register. */
export const GET: RequestHandler = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'hotel:admin');
	const hotel = locals.hotel!;
	const filter = parseAuditFilter(url.searchParams);
	const { entries, truncated } = await exportAuditLog(hotel.id, filter, hotel.timezone);
	const doc = buildAuditRegisterDoc(entries, {
		timezone: hotel.timezone,
		period: `${filter.from ?? 'start'} to ${filter.to ?? 'today'}`,
		filters: [],
		truncatedAt: truncated ? AUDIT_EXPORT_MAX : null
	});
	const { headers, rows } = docToCsv(doc);
	const safe = rows.map((r) => r.map((c) => (typeof c === 'string' ? safeCell(c) : c)));
	// A byte-order mark so Excel reads the text as UTF-8.
	return new Response('\uFEFF' + toCsv(headers, safe), {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="audit-log-${filter.from ?? 'start'}-to-${filter.to ?? 'today'}.csv"`,
			'cache-control': 'no-store'
		}
	});
};
