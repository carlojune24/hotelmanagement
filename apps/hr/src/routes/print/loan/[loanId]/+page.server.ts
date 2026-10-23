import { error } from '@sveltejs/kit';
import { requireCap, requireUser } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { getOrganization } from '$lib/server/establishments';
import { listLoanTypes, listLoans, listPayments, loanHistory } from '$lib/server/hr/loans';
import type { PageServerLoad } from './$types';

/**
 * A loan's statement of account: what was owed, every amount taken or received, and the balance after
 * each. Only entries that count are listed (a draft payslip is not final). Main HR only; audited.
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireUser(locals.user, url.pathname);
	requireCap(locals.user, locals.access, 'payroll:*');
	const org = await getOrganization();
	// A malformed id would be a Postgres uuid error, not a 404.
	if (!/^[0-9a-f-]{36}$/i.test(params.loanId)) error(404, 'Not found');
	const loan = (await listLoans(org.id, { id: params.loanId }))[0];
	if (!loan) error(404, 'Not found');
	const [types, history, payments] = await Promise.all([listLoanTypes(org.id), loanHistory(loan.id), listPayments(loan.id)]);

	type Entry = { date: string; label: string; amount: number; note: string | null };
	const entries: Entry[] = [];
	for (const h of history) {
		if (h.status === 'draft' || h.deductedCentavos === 0) continue;
		entries.push({
			date: h.cutoffEnd,
			label: `Payroll ${h.cutoffStart} – ${h.cutoffEnd}`,
			amount: h.deductedCentavos,
			note: h.deductedCentavos < h.dueCentavos ? `${(h.dueCentavos - h.deductedCentavos) / 100} short, carried over` : null
		});
	}
	const voided = payments.filter((p) => p.voidedAt).length;
	for (const p of payments) {
		if (p.voidedAt) continue;
		entries.push({ date: p.paidOn, label: 'Received directly', amount: p.amountCentavos, note: p.note });
	}
	entries.sort((a, b) => a.date.localeCompare(b.date));

	let balance = loan.principalCentavos - loan.alreadyPaidCentavos;
	const rows = entries.map((e) => {
		balance -= e.amount;
		return { ...e, balance: Math.max(0, balance) };
	});

	await writeAudit({
		actor: locals.user,
		action: 'loan.statement_print',
		entityType: 'employee_loan',
		entityId: loan.id
	});

	return {
		company: org.name,
		employee: { name: loan.employeeName, no: loan.employeeNo },
		loan: {
			kindLabel: types.find((t) => t.key === loan.kind)?.name ?? loan.kind,
			referenceNo: loan.referenceNo,
			principal: loan.principalCentavos,
			amortization: loan.amortizationCentavos,
			alreadyPaid: loan.alreadyPaidCentavos,
			startPeriod: loan.startPeriod,
			releasedOn: loan.releasedOn,
			termMonths: loan.termMonths,
			status: loan.status,
			statusNote: loan.statusNote
		},
		rows,
		voided,
		balance: loan.balanceCentavos,
		asOf: new Date().toISOString().slice(0, 10)
	};
};
