import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { getOrganization } from '$lib/server/establishments';
import { businessDateFor } from '$lib/server/time';
import {
	LoanError,
	createLoan,
	editLoan,
	listLoans,
	loanEditSchema,
	loanFormSchema,
	loanHistory,
	listLoanTypes,
	loanableEmployees,
	setLoanStatus,
	statusSchema
} from '$lib/server/hr/loans';
import type { Actions, PageServerLoad } from './$types';

const TZ = 'Asia/Manila';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.access, 'payroll:*');
	const org = await getOrganization();
	const [loans, people, types] = await Promise.all([listLoans(org.id), loanableEmployees(org.id), listLoanTypes(org.id)]);
	const typeByKey = new Map(types.map((t) => [t.key, t]));
	const openId = url.searchParams.get('loan');
	const history = openId && loans.some((l) => l.id === openId) ? await loanHistory(openId) : [];
	return {
		loans: loans.map((l) => ({
			id: l.id,
			employeeName: l.employeeName,
			employeeNo: l.employeeNo,
			kind: l.kind,
			kindLabel: typeByKey.get(l.kind)?.name ?? l.kind,
			remitted: (typeByKey.get(l.kind)?.remitTo ?? 'none') !== 'none',
			referenceNo: l.referenceNo,
			principal: l.principalCentavos,
			amortization: l.amortizationCentavos,
			startPeriod: l.startPeriod,
			status: l.status as 'active' | 'paused' | 'paid_off' | 'cancelled',
			statusNote: l.statusNote,
			note: l.note,
			deducted: l.deductedCentavos,
			balance: l.balanceCentavos
		})),
		people,
		/** Everything, for the filter. */
		kinds: types.map((t) => ({ value: t.key, label: t.active ? t.name : `${t.name} (retired)` })),
		/** Only active types can be chosen for a new loan. */
		newKinds: types.filter((t) => t.active).map((t) => ({ value: t.key, label: t.name })),
		openId,
		history,
		thisMonth: businessDateFor(TZ).slice(0, 7)
	};
};

const fd = async (request: Request) => Object.fromEntries(await request.formData());

export const actions: Actions = {
	create: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'payroll:*');
		const parsed = loanFormSchema.safeParse(await fd(request));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the loan details.' });
		try {
			const org = await getOrganization();
			const loan = await createLoan(org.id, parsed.data, locals.user!.id);
			await writeAudit({
				actor: locals.user,
				action: 'loan.create',
				entityType: 'employee_loan',
				entityId: loan.id,
				after: {
					employeeId: loan.employeeId,
					kind: loan.kind,
					principalCentavos: loan.principalCentavos,
					amortizationCentavos: loan.amortizationCentavos,
					startPeriod: loan.startPeriod
				}
			});
		} catch (e) {
			if (e instanceof LoanError) return fail(400, { error: e.message });
			throw e;
		}
		return { ok: 'Loan recorded. It is deducted from the next payroll you generate.' };
	},

	edit: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'payroll:*');
		const parsed = loanEditSchema.safeParse(await fd(request));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the amounts.' });
		try {
			const org = await getOrganization();
			const { before, after } = await editLoan(org.id, parsed.data);
			await writeAudit({
				actor: locals.user,
				action: 'loan.edit',
				entityType: 'employee_loan',
				entityId: after.id,
				before: { amortizationCentavos: before.amortizationCentavos, referenceNo: before.referenceNo },
				after: { amortizationCentavos: after.amortizationCentavos, referenceNo: after.referenceNo }
			});
		} catch (e) {
			if (e instanceof LoanError) return fail(400, { error: e.message });
			throw e;
		}
		return { ok: 'Saved. Regenerate any draft payroll to pick up the new amount.' };
	},

	status: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'payroll:*');
		const parsed = statusSchema.safeParse(await fd(request));
		if (!parsed.success) return fail(400, { error: z.prettifyError(parsed.error) });
		try {
			const org = await getOrganization();
			const loan = await setLoanStatus(org.id, parsed.data);
			await writeAudit({
				actor: locals.user,
				action: `loan.${parsed.data.to}`,
				entityType: 'employee_loan',
				entityId: loan.id,
				after: { status: loan.status, note: parsed.data.note ?? null }
			});
		} catch (e) {
			if (e instanceof LoanError) return fail(400, { error: e.message });
			throw e;
		}
		return { ok: 'Updated.' };
	}
};
