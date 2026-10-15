import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { requireCap, requireUser } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { db } from '$lib/server/db/index';
import { establishments } from '$lib/server/db/schema/index';
import { leaveBalances } from '$lib/server/hr/leave';
import { leaveCard } from '$lib/server/hr/leave-card';
import { businessDateFor } from '$lib/server/time';
import type { PageServerLoad } from './$types';

/**
 * Leave cards for one year: `?employee=<id>` prints one, otherwise every current employee of the
 * establishment, one card per page. Same capability as the Leave screen; read-only and audited.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	requireUser(locals.user, url.pathname);
	const est = locals.establishment;
	if (!est) error(404, 'Not found');
	requireCap(locals.user, locals.access, 'leave:file', est.id);

	const yearParam = Number(url.searchParams.get('year'));
	const year =
		Number.isInteger(yearParam) && yearParam >= 2000 && yearParam <= 2100
			? yearParam
			: Number(businessDateFor(est.timezone).slice(0, 4));

	const only = url.searchParams.get('employee');
	const ids = only ? [only] : (await leaveBalances(est.id, year)).rows.map((r) => r.employeeId);
	const cards = (await Promise.all(ids.map((id) => leaveCard(est.id, id, year)))).filter((c) => c !== null);
	if (only && cards.length === 0) error(404, 'Not found');

	const header = await db
		.select({ legalName: establishments.legalName, name: establishments.name })
		.from(establishments)
		.where(eq(establishments.id, est.id))
		.then((r) => r.at(0));

	await writeAudit({
		establishmentId: est.id,
		actor: locals.user,
		action: 'leave.card_print',
		entityType: 'leave_card',
		entityId: only,
		after: { year, cards: cards.length }
	});

	return {
		year,
		company: header?.legalName || header?.name || est.name,
		establishment: est.name,
		cards
	};
};
