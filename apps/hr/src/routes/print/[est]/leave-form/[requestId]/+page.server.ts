import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { requireCap, requireUser } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { db } from '$lib/server/db/index';
import { establishments } from '$lib/server/db/schema/index';
import { leaveForm } from '$lib/server/hr/leave-card';
import type { PageServerLoad } from './$types';

/** One leave request as a form to sign and file, with the balance before and after it. */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireUser(locals.user, url.pathname);
	const est = locals.establishment;
	if (!est) error(404, 'Not found');
	requireCap(locals.user, locals.access, 'leave:file', est.id);

	const f = await leaveForm(est.id, params.requestId);
	if (!f) error(404, 'Not found');

	const header = await db
		.select({ legalName: establishments.legalName, name: establishments.name })
		.from(establishments)
		.where(eq(establishments.id, est.id))
		.then((r) => r.at(0));

	await writeAudit({
		establishmentId: est.id,
		actor: locals.user,
		action: 'leave.form_print',
		entityType: 'leave_request',
		entityId: f.request.id
	});

	const r = f.request;
	return {
		company: header?.legalName || header?.name || est.name,
		establishment: est.name,
		employee: f.employee,
		typeName: f.typeName,
		request: {
			start: r.startDate,
			end: r.endDate,
			halfDay: r.halfDay as 'am' | 'pm' | null,
			days: r.days,
			paid: r.paid,
			reason: r.reason,
			documentNote: r.documentNote,
			status: r.status,
			decisionNote: r.decisionNote,
			cancelNote: r.cancelNote,
			filedAt: r.createdAt.toISOString().slice(0, 10),
			decidedAt: r.decidedAt ? r.decidedAt.toISOString().slice(0, 10) : null
		},
		filedBy: f.filedBy,
		decidedBy: f.decidedBy,
		before: f.before,
		after: f.after
	};
};
