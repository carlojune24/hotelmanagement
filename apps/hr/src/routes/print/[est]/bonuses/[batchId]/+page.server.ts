import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { requireCap, requireUser } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { db } from '$lib/server/db/index';
import { establishments } from '$lib/server/db/schema/index';
import { getOrganization } from '$lib/server/establishments';
import { BonusError, getBatchView } from '$lib/server/hr/bonuses';
import type { PageServerLoad } from './$types';

/**
 * One establishment's bonus register (and, under `/slips`, a slip per person). Main HR only, since it
 * lists everyone's pay; every print is audited. A draft prints with a banner.
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireUser(locals.user, url.pathname);
	requireCap(locals.user, locals.access, 'payroll:*');
	const est = locals.establishment;
	if (!est) error(404, 'Not found');
	const org = await getOrganization();
	let batch;
	try {
		batch = await getBatchView(org.id, params.batchId);
	} catch (e) {
		if (e instanceof BonusError) error(404, 'Not found');
		throw e;
	}
	if (batch.establishmentId !== est.id) error(404, 'Not found');

	const header = await db
		.select({ legalName: establishments.legalName, name: establishments.name, address: establishments.addressLine, city: establishments.city })
		.from(establishments)
		.where(eq(establishments.id, est.id))
		.then((r) => r.at(0));
	await writeAudit({
		actor: locals.user,
		action: 'bonus.print',
		entityType: 'bonus_batch',
		entityId: batch.id,
		after: { status: batch.status, people: batch.paidCount }
	});

	return {
		draft: batch.status === 'draft',
		company: { name: header?.legalName || header?.name || est.name, address: [header?.address, header?.city].filter(Boolean).join(', ') },
		establishment: est.name,
		slug: est.slug,
		batch: {
			id: batch.id,
			label: batch.label,
			year: batch.year,
			kind: batch.kind,
			status: batch.status,
			issuedOn: batch.issuedOn,
			throughDate: batch.throughDate,
			total: batch.total
		},
		// An issued register lists only people actually paid; a draft shows everyone so it matches the screen.
		lines: batch.status === 'draft' ? batch.lines : batch.lines.filter((l) => l.amount > 0)
	};
};
