import { error } from '@sveltejs/kit';
import { requireCap, requireUser } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { getOrganization } from '$lib/server/establishments';
import { ITEM_KIND_LABEL, KIND_LABEL, SeparationError, getSeparation } from '$lib/server/hr/separations';
import type { PageServerLoad } from './$types';

/**
 * A person's final-pay and clearance statement. It lists what is owed to them, what is charged and taken
 * against it, what is still owed, and the checklist, with room for signatures. Main HR only; audited.
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireUser(locals.user, url.pathname);
	requireCap(locals.user, locals.access, 'payroll:*');
	const org = await getOrganization();
	let v;
	try {
		v = await getSeparation(org.id, params.id);
	} catch (e) {
		if (e instanceof SeparationError) error(404, 'Not found');
		throw e;
	}
	await writeAudit({
		actor: locals.user,
		action: 'separation.print',
		entityType: 'separation',
		entityId: v.sep.id
	});

	return {
		company: org.name,
		employee: v.employee,
		kind: KIND_LABEL[v.sep.kind],
		lastDay: v.sep.lastDay,
		note: v.sep.note,
		status: v.sep.status,
		clearedAt: v.sep.clearedAt,
		finalPayPaidOn: v.sep.finalPayPaidOn,
		// Voided lines are history, not part of the statement.
		items: v.items
			.filter((i) => !i.voidedAt)
			.map((i) => ({ id: i.id, kind: i.kind, kindLabel: ITEM_KIND_LABEL[i.kind], label: i.label, amount: i.amountCentavos, note: i.note, source: i.source })),
		// The 13th month is computed in full, then any mid-year installment already issued comes off it.
		thirteenth: { computed: v.thirteenth.amount, midYearPaid: v.thirteenth.midYearPaid },
		applied: v.applied
			.filter((a) => !a.voidedAt)
			.map((a) => ({ id: a.id, label: a.loanLabel, referenceNo: a.referenceNo, paidOn: a.paidOn, amount: a.amountCentavos })),
		openLoans: v.loans.map((l) => ({ id: l.id, label: l.label, referenceNo: l.referenceNo, balance: l.balance })),
		clearance: v.clearance.map((c) => ({ id: c.id, label: c.label, doneAt: c.doneAt })),
		totals: v.totals,
		asOf: new Date().toISOString().slice(0, 10)
	};
};
