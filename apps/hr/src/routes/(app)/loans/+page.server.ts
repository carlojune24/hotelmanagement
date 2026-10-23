import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { getOrganization } from '$lib/server/establishments';
import { db } from '$lib/server/db/index';
import { separations } from '$lib/server/db/schema/index';
import { eq } from 'drizzle-orm';
import { businessDateFor } from '$lib/server/time';
import {
	LoanError,
	addDocument,
	addPayment,
	addSkip,
	createLoan,
	editLoan,
	listDocuments,
	countLoans,
	listLoans,
	listPayments,
	listSkips,
	loanEditSchema,
	loanFormSchema,
	loanHistory,
	listLoanTypes,
	loanableEmployees,
	monthsAfter,
	paymentSchema,
	removeDocument,
	removeSkip,
	scheduleStatus,
	setLoanStatus,
	skipMonthsByLoan,
	skipSchema,
	statusSchema,
	upcomingSkips,
	voidPayment,
	voidPaymentSchema
} from '$lib/server/hr/loans';
import { UploadValidationError } from '$lib/server/uploads';
import type { Actions, PageServerLoad } from './$types';

const TZ = 'Asia/Manila';
const PAGE_SIZES = [10, 25, 50, 100];
const STATUS_FILTERS = {
	active: ['active'],
	paused: ['paused'],
	closed: ['paid_off', 'cancelled'],
	all: undefined
} as const;

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.access, 'payroll:*');
	const org = await getOrganization();
	const thisMonth = businessDateFor(TZ).slice(0, 7);
	const sp = url.searchParams;
	const status = (Object.keys(STATUS_FILTERS) as Array<keyof typeof STATUS_FILTERS>).find((k) => k === sp.get('status')) ?? 'active';
	const types = await listLoanTypes(org.id);
	const kind = types.find((t) => t.key === sp.get('kind'))?.key ?? 'all';
	const q = (sp.get('q') ?? '').trim().slice(0, 60);
	const size = Number(sp.get('size'));
	const pageSize = PAGE_SIZES.includes(size) ? size : 10;
	const statuses = STATUS_FILTERS[status];
	const qLower = q.toLowerCase();
	const qKinds = q ? types.filter((t) => t.name.toLowerCase().includes(qLower)).map((t) => t.key) : [];
	const filter = { statuses: statuses ? [...statuses] : undefined, kind: kind === 'all' ? undefined : kind, q, qKinds };
	const [total, orgTotal] = await Promise.all([countLoans(org.id, filter), countLoans(org.id)]);
	const pageCount = Math.max(1, Math.ceil(total / pageSize));
	const page = Math.min(Math.max(1, Math.trunc(Number(sp.get('page'))) || 1), pageCount);
	const openId = sp.get('loan');
	const [pageLoans, live, people, openRows] = await Promise.all([
		listLoans(org.id, { ...filter, page: { size: pageSize, offset: (page - 1) * pageSize } }),
		// The summary only concerns loans still being deducted, so closed history is never loaded in full.
		listLoans(org.id, { statuses: ['active', 'paused'] }),
		loanableEmployees(org.id),
		openId ? listLoans(org.id, { id: openId }) : Promise.resolve([])
	]);
	const openLoan = openRows[0] ?? null;
	const loans = [...new Map([...pageLoans, ...live, ...(openLoan ? [openLoan] : [])].map((l) => [l.id, l])).values()];
	const ids = loans.map((l) => l.id);
	const sepRows = await db
		.select({ id: separations.id, employeeId: separations.employeeId })
		.from(separations)
		.where(eq(separations.organizationId, org.id));
	const sepOf = new Map(sepRows.map((s) => [s.employeeId, s.id]));
	const [upcoming, skipMonths] = await Promise.all([upcomingSkips(ids, thisMonth), skipMonthsByLoan(ids)]);
	/** Only a loan being deducted has a schedule to be behind. */
	const schedule = new Map(
		loans.map((l) => [
			l.id,
			l.status === 'active'
				? scheduleStatus({
						principal: l.principalCentavos,
						alreadyPaid: l.alreadyPaidCentavos,
						amortization: l.amortizationCentavos,
						startPeriod: l.startPeriod,
						thisMonth,
						skips: skipMonths.get(l.id) ?? new Set(),
						paidSince: l.deductedCentavos + l.paidOutsideCentavos
					})
				: null
		])
	);
	const typeByKey = new Map(types.map((t) => [t.key, t]));
	const isOpen = !!openId && !!openLoan;
	const history = isOpen ? await loanHistory(openId) : [];
	const skips = isOpen ? await listSkips(openId) : [];
	const payments = isOpen ? await listPayments(openId) : [];
	const documents = isOpen ? await listDocuments(openId) : [];

	const soon = monthsAfter(thisMonth, 2);
	const byType = new Map<string, { label: string; count: number; outstanding: number }>();
	for (const l of live) {
		const label = typeByKey.get(l.kind)?.name ?? l.kind;
		const cur = byType.get(l.kind) ?? { label, count: 0, outstanding: 0 };
		cur.count += 1;
		cur.outstanding += l.balanceCentavos;
		byType.set(l.kind, cur);
	}
	const behind = loans.filter((l) => (schedule.get(l.id)?.behind ?? 0) > 0);
	const separated = live.filter((l) => l.employeeStatus === 'separated' && l.balanceCentavos > 0);
	const summary = {
		open: live.length,
		outstanding: live.reduce((t, l) => t + l.balanceCentavos, 0),
		byType: [...byType.values()].sort((a, b) => b.outstanding - a.outstanding),
		behindCount: behind.length,
		behindAmount: behind.reduce((t, l) => t + (schedule.get(l.id)?.behind ?? 0), 0),
		endingSoon: loans.filter((l) => {
			const end = schedule.get(l.id)?.expectedEnd;
			return !!end && end <= soon;
		}).length,
		separatedCount: separated.length,
		separatedOwed: separated.reduce((t, l) => t + l.balanceCentavos, 0)
	};
	const toRow = (l: (typeof loans)[number]) => ({
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
		alreadyPaid: l.alreadyPaidCentavos,
		paidOutside: l.paidOutsideCentavos,
		deducted: l.deductedCentavos,
		balance: l.balanceCentavos,
		releasedOn: l.releasedOn,
		termMonths: l.termMonths,
		employeeStatus: l.employeeStatus,
		separationId: sepOf.get(l.employeeId) ?? null,
		separatedOn: l.separatedOn,
		behind: schedule.get(l.id)?.behind ?? 0,
		expectedEnd: schedule.get(l.id)?.expectedEnd ?? null,
		upcomingSkips: upcoming.get(l.id) ?? []
	});
	return {
		loans: pageLoans.map(toRow),
		openLoan: openLoan ? toRow(openLoan) : null,
		hasLoans: orgTotal > 0,
		params: { q, status, kind },
		page,
		pageCount,
		pageSize,
		pageSizes: PAGE_SIZES,
		total,
		people,
		/** Everything, for the filter. */
		kinds: types.map((t) => ({ value: t.key, label: t.active ? t.name : `${t.name} (retired)` })),
		/** Only active types can be chosen for a new loan. */
		newKinds: types.filter((t) => t.active).map((t) => ({ value: t.key, label: t.name })),
		openId,
		history,
		skips,
		payments,
		documents,
		summary,
		thisMonth,
		today: businessDateFor(TZ)
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
					alreadyPaidCentavos: loan.alreadyPaidCentavos,
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
				before: {
					principalCentavos: before.principalCentavos,
					startPeriod: before.startPeriod,
					releasedOn: before.releasedOn,
					termMonths: before.termMonths,
					amortizationCentavos: before.amortizationCentavos,
					alreadyPaidCentavos: before.alreadyPaidCentavos,
					referenceNo: before.referenceNo
				},
				after: {
					principalCentavos: after.principalCentavos,
					startPeriod: after.startPeriod,
					releasedOn: after.releasedOn,
					termMonths: after.termMonths,
					amortizationCentavos: after.amortizationCentavos,
					alreadyPaidCentavos: after.alreadyPaidCentavos,
					referenceNo: after.referenceNo
				}
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
	},

	payment: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'payroll:*');
		const parsed = paymentSchema.safeParse(await fd(request));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the payment.' });
		try {
			const org = await getOrganization();
			const { payment, loan } = await addPayment(org.id, parsed.data, locals.user!.id);
			await writeAudit({
				actor: locals.user,
				action: 'loan.payment_add',
				entityType: 'employee_loan',
				entityId: loan.id,
				after: { paidOn: payment.paidOn, amountCentavos: payment.amountCentavos, note: payment.note }
			});
		} catch (e) {
			if (e instanceof LoanError) return fail(400, { error: e.message });
			throw e;
		}
		return { ok: 'Payment recorded.' };
	},

	voidPayment: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'payroll:*');
		const parsed = voidPaymentSchema.safeParse(await fd(request));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Say why it is voided.' });
		try {
			const org = await getOrganization();
			const { payment, loan } = await voidPayment(org.id, parsed.data, locals.user!.id);
			await writeAudit({
				actor: locals.user,
				action: 'loan.payment_void',
				entityType: 'employee_loan',
				entityId: loan.id,
				before: { paidOn: payment.paidOn, amountCentavos: payment.amountCentavos },
				after: { reason: parsed.data.reason }
			});
		} catch (e) {
			if (e instanceof LoanError) return fail(400, { error: e.message });
			throw e;
		}
		return { ok: 'Payment voided.' };
	},

	upload: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'payroll:*');
		const form = await request.formData();
		const loanId = z.string().uuid().safeParse(form.get('loanId'));
		const file = form.get('file');
		if (!loanId.success) return fail(400, { error: 'That loan does not exist.' });
		if (!(file instanceof File) || file.size === 0) return fail(400, { error: 'Choose a file to attach.' });
		try {
			const org = await getOrganization();
			const { document, loan } = await addDocument(org.id, loanId.data, file, locals.user!.id);
			await writeAudit({
				actor: locals.user,
				action: 'loan.document_add',
				entityType: 'employee_loan',
				entityId: loan.id,
				after: { name: document.originalName, sizeBytes: document.sizeBytes }
			});
		} catch (e) {
			if (e instanceof LoanError || e instanceof UploadValidationError) return fail(400, { error: e.message });
			throw e;
		}
		return { ok: 'Document attached.' };
	},

	removeDocument: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'payroll:*');
		const parsed = z.object({ documentId: z.string().uuid() }).safeParse(await fd(request));
		if (!parsed.success) return fail(400, { error: 'That document does not exist.' });
		try {
			const org = await getOrganization();
			const doc = await removeDocument(org.id, parsed.data.documentId);
			await writeAudit({
				actor: locals.user,
				action: 'loan.document_remove',
				entityType: 'employee_loan',
				entityId: doc.loanId,
				before: { name: doc.originalName }
			});
		} catch (e) {
			if (e instanceof LoanError) return fail(400, { error: e.message });
			throw e;
		}
		return { ok: 'Document removed.' };
	},

	skip: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'payroll:*');
		const parsed = skipSchema.safeParse(await fd(request));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the month and reason.' });
		try {
			const org = await getOrganization();
			const { skip } = await addSkip(org.id, parsed.data, locals.user!.id);
			await writeAudit({
				actor: locals.user,
				action: 'loan.skip_add',
				entityType: 'employee_loan',
				entityId: skip.loanId,
				after: { payMonth: skip.payMonth, reason: skip.reason }
			});
		} catch (e) {
			if (e instanceof LoanError) return fail(400, { error: e.message });
			throw e;
		}
		return { ok: 'Month skipped. Regenerate any draft payroll for that month to apply it.' };
	},

	unskip: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'payroll:*');
		const parsed = z.object({ skipId: z.string().uuid() }).safeParse(await fd(request));
		if (!parsed.success) return fail(400, { error: 'That skip does not exist.' });
		try {
			const org = await getOrganization();
			const { skip } = await removeSkip(org.id, parsed.data.skipId);
			await writeAudit({
				actor: locals.user,
				action: 'loan.skip_remove',
				entityType: 'employee_loan',
				entityId: skip.loanId,
				before: { payMonth: skip.payMonth, reason: skip.reason }
			});
		} catch (e) {
			if (e instanceof LoanError) return fail(400, { error: e.message });
			throw e;
		}
		return { ok: 'Skip removed.' };
	}
};
