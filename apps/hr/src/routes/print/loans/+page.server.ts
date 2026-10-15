import { requireCap, requireUser } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { getOrganization } from '$lib/server/establishments';
import { listLoanTypes, listLoans } from '$lib/server/hr/loans';
import type { PageServerLoad } from './$types';

const STATUSES = {
	active: ['active'],
	paused: ['paused'],
	closed: ['paid_off', 'cancelled'],
	all: undefined
} as const;
const TITLE = { active: 'Active loans', paused: 'Paused loans', closed: 'Closed loans', all: 'All loans' } as const;

/** The loans list as filtered on the Loans page (`?status=&kind=&q=`), every match, not one page. Main HR only; audited. */
export const load: PageServerLoad = async ({ locals, url }) => {
	requireUser(locals.user, url.pathname + url.search);
	requireCap(locals.user, locals.access, 'payroll:*');
	const org = await getOrganization();
	const sp = url.searchParams;
	const status = (Object.keys(STATUSES) as Array<keyof typeof STATUSES>).find((k) => k === sp.get('status')) ?? 'active';
	const types = await listLoanTypes(org.id);
	const typeKind = types.find((t) => t.key === sp.get('kind'));
	const q = (sp.get('q') ?? '').trim().slice(0, 60);
	const qKinds = q ? types.filter((t) => t.name.toLowerCase().includes(q.toLowerCase())).map((t) => t.key) : [];
	const statuses = STATUSES[status];
	const loans = await listLoans(org.id, {
		statuses: statuses ? [...statuses] : undefined,
		kind: typeKind?.key,
		q,
		qKinds
	});
	await writeAudit({ actor: locals.user, action: 'loan.list_print', entityType: 'employee_loan', entityId: null });
	const label = (k: string) => types.find((t) => t.key === k)?.name ?? k;
	return {
		company: org.name,
		title: `${TITLE[status]}${typeKind ? `: ${typeKind.name}` : ''}`,
		query: q,
		rows: loans.map((l) => ({
			id: l.id,
			employeeName: l.employeeName,
			employeeNo: l.employeeNo,
			kind: label(l.kind),
			referenceNo: l.referenceNo,
			principal: l.principalCentavos,
			amortization: l.amortizationCentavos,
			paid: l.alreadyPaidCentavos + l.deductedCentavos + l.paidOutsideCentavos,
			balance: l.balanceCentavos,
			startPeriod: l.startPeriod,
			status: l.status as 'active' | 'paused' | 'paid_off' | 'cancelled'
		})),
		principal: loans.reduce((t, l) => t + l.principalCentavos, 0),
		balance: loans.reduce((t, l) => t + l.balanceCentavos, 0)
	};
};
