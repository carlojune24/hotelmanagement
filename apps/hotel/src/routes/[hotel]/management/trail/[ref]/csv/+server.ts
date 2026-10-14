import { error } from '@sveltejs/kit';
import { roleCan } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import { toCsv } from '$lib/server/finance/calc';
import { safeCell } from '$lib/server/booking-transactions-csv';
import { buildDiningTrail } from '$lib/server/dining-trail';
import { buildTrailDoc } from '$lib/dining-trail-doc';
import { docToCsv } from '$lib/dining-report-doc';
import type { RequestHandler } from './$types';

/** The trail as a CSV, drawn from the same document model as the printed sheet. */
export const GET: RequestHandler = async ({ locals, params }) => {
	requireCap(locals.user, locals.role, 'dining:read');
	const hotel = locals.hotel!;
	const admin = !!locals.user?.isPlatformAdmin || (!!locals.role && roleCan(locals.role.capabilities, 'hotel:admin'));
	const trail = await buildDiningTrail(hotel.id, params.ref, { admin });
	if (!trail) error(404, 'No dining order or table reservation has that number.');

	const { headers, rows } = docToCsv(buildTrailDoc(trail, { timezone: hotel.timezone }));
	// Guest names, messages and cancel reasons are typed by strangers: keep them from reading as formulas.
	const safe = rows.map((r) => r.map((c) => (typeof c === 'string' ? safeCell(c) : c)));
	// A byte-order mark so Excel reads the peso text and dashes as UTF-8.
	return new Response('﻿' + toCsv(headers, safe), {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="trail-${trail.ref}.csv"`,
			'cache-control': 'no-store'
		}
	});
};
