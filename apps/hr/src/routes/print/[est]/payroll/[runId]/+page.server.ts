import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { requireCap, requireUser } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { db } from '$lib/server/db/index';
import { establishments } from '$lib/server/db/schema/index';
import { PayrollError } from '$lib/server/hr/payroll';
import { runView } from '$lib/server/hr/payroll-view';
import type { PageServerLoad } from './$types';

/**
 * One establishment's payroll register for a run — Main HR only (it lists everyone's pay), and every
 * print is audited. A draft prints with a banner so it is never mistaken for the final.
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireUser(locals.user, url.pathname);
	requireCap(locals.user, locals.access, 'payroll:*');
	const est = locals.establishment;
	if (!est) error(404, 'Not found');

	let view;
	try {
		view = await runView(params.runId);
	} catch (e) {
		if (e instanceof PayrollError) error(404, 'Not found');
		throw e;
	}
	const batch = view.batches.find((b) => b.establishmentId === est.id);
	if (!batch) error(404, 'Not found');

	const header = await db
		.select({ legalName: establishments.legalName, name: establishments.name, address: establishments.addressLine, city: establishments.city })
		.from(establishments)
		.where(eq(establishments.id, est.id))
		.then((r) => r.at(0));

	await writeAudit({
		actor: locals.user,
		action: 'payroll.print',
		entityType: 'payroll_batch',
		entityId: batch.id,
		after: { runId: view.run.id, payslips: batch.lines.length, status: batch.status }
	});

	return {
		draft: batch.status === 'draft',
		status: batch.status,
		company: { name: header?.legalName || header?.name || est.name, address: [header?.address, header?.city].filter(Boolean).join(', ') },
		establishment: est.name,
		period: { start: view.run.cutoffStart, end: view.run.cutoffEnd, payDate: view.run.payDate },
		lines: batch.lines
	};
};
