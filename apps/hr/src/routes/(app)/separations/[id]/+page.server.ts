import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { getOrganization } from '$lib/server/establishments';
import { voidPayment, voidPaymentSchema } from '$lib/server/hr/loans';
import {
	ITEM_KIND_LABEL,
	KIND_LABEL,
	SeparationError,
	addClearanceItem,
	addItem,
	addThirteenthMonth,
	applyLoanSchema,
	applyToLoan,
	clearSeparation,
	getSeparation,
	itemSchema,
	markFinalPayPaid,
	setEntitlement,
	setLastDay,
	toggleClearance,
	voidItem
} from '$lib/server/hr/separations';
import { businessDateFor } from '$lib/server/time';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	requireCap(locals.user, locals.access, 'payroll:*');
	const org = await getOrganization();
	try {
		const view = await getSeparation(org.id, params.id);
		return {
			...view,
			kindLabel: KIND_LABEL[view.sep.kind],
			itemKindLabel: ITEM_KIND_LABEL,
			today: businessDateFor('Asia/Manila')
		};
	} catch (e) {
		if (e instanceof SeparationError) error(404, 'Not found');
		throw e;
	}
};

const fd = async (request: Request) => Object.fromEntries(await request.formData());

/** Runs one action: access check, SeparationError → a form failure, an audit entry on success. */
async function act(
	event: { request: Request; locals: App.Locals; params: { id: string } },
	run: (orgId: string, data: Record<string, FormDataEntryValue>, userId: string) => Promise<{ ok: string; audit: string; after?: object }>
) {
	requireCap(event.locals.user, event.locals.access, 'payroll:*');
	try {
		const org = await getOrganization();
		const out = await run(org.id, await fd(event.request), event.locals.user!.id);
		await writeAudit({
			actor: event.locals.user,
			action: out.audit,
			entityType: 'separation',
			entityId: event.params.id,
			after: out.after
		});
		return { ok: out.ok };
	} catch (e) {
		if (e instanceof SeparationError) return fail(400, { error: e.message });
		if (e instanceof Error && e.name === 'ZodError') return fail(400, { error: 'Check the details.' });
		throw e;
	}
}

const bad = (m: string) => new SeparationError(m);

export const actions: Actions = {
	lastDay: (event) =>
		act(event, async (org, d) => {
			const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(d.lastDay);
			if (!day.success) throw bad('Pick a date.');
			await setLastDay(org, event.params.id, day.data);
			return { ok: 'Last day updated.', audit: 'separation.last_day', after: { lastDay: day.data } };
		}),

	addItem: (event) =>
		act(event, async (org, d) => {
			const p = itemSchema.safeParse({ ...d, separationId: event.params.id });
			if (!p.success) throw bad(p.error.issues[0]?.message ?? 'Check the line.');
			await addItem(org, p.data);
			return { ok: 'Added.', audit: 'separation.item_add', after: { kind: p.data.kind, label: p.data.label, amount: p.data.amount } };
		}),

	thirteenth: (event) =>
		act(event, async (org) => {
			const r = await addThirteenthMonth(org, event.params.id);
			return {
				ok: '13th month added to the statement.',
				audit: 'separation.thirteenth_month',
				after: { year: r.result.year, amountCentavos: r.result.amount, basicEarned: r.result.basicEarned }
			};
		}),

	entitlement: (event) =>
		act(event, async (org, d) => {
			const covered = d.covered === '1';
			await setEntitlement(org, event.params.id, covered, String(d.note ?? ''));
			return {
				ok: covered ? 'Marked as entitled to the 13th month.' : 'Marked as not entitled to the 13th month.',
				audit: 'separation.thirteenth_entitlement',
				after: { covered, note: String(d.note ?? '') }
			};
		}),

	voidItem: (event) =>
		act(event, async (org, d) => {
			const p = z.object({ itemId: z.string().uuid(), reason: z.string() }).safeParse(d);
			if (!p.success) throw bad('Say why this line is voided.');
			await voidItem(org, p.data.itemId, p.data.reason);
			return { ok: 'Line voided.', audit: 'separation.item_void', after: { reason: p.data.reason } };
		}),

	applyLoan: (event) =>
		act(event, async (org, d, userId) => {
			const p = applyLoanSchema.safeParse({ ...d, separationId: event.params.id });
			if (!p.success) throw bad(p.error.issues[0]?.message ?? 'Check the amount.');
			await applyToLoan(org, p.data, userId);
			return { ok: 'Taken from final pay and applied to the loan.', audit: 'separation.loan_apply', after: { loanId: p.data.loanId, amount: p.data.amount } };
		}),

	undoLoan: (event) =>
		act(event, async (org, d, userId) => {
			const p = voidPaymentSchema.safeParse(d);
			if (!p.success) throw bad(p.error.issues[0]?.message ?? 'Say why this is undone.');
			await voidPayment(org, p.data, userId);
			return { ok: 'Undone. The amount is back in final pay.', audit: 'separation.loan_undo', after: { reason: p.data.reason } };
		}),

	paid: (event) =>
		act(event, async (org, _d, userId) => {
			const r = await markFinalPayPaid(org, event.params.id, userId);
			return { ok: 'Final pay marked as handed over.', audit: 'separation.final_pay_paid', after: { amountCentavos: r.amount } };
		}),

	check: (event) =>
		act(event, async (org, d, userId) => {
			const p = z.object({ itemId: z.string().uuid(), done: z.enum(['0', '1']) }).safeParse(d);
			if (!p.success) throw bad('That checklist item does not exist.');
			await toggleClearance(org, p.data.itemId, p.data.done === '1', userId);
			return { ok: p.data.done === '1' ? 'Marked done.' : 'Marked not done.', audit: 'separation.clearance_toggle', after: { done: p.data.done } };
		}),

	addCheck: (event) =>
		act(event, async (org, d) => {
			await addClearanceItem(org, event.params.id, String(d.label ?? ''));
			return { ok: 'Checklist item added.', audit: 'separation.clearance_add', after: { label: String(d.label ?? '') } };
		}),

	clear: (event) =>
		act(event, async (org, _d, userId) => {
			await clearSeparation(org, event.params.id, userId);
			return { ok: 'Cleared. This person has no open items.', audit: 'separation.cleared' };
		})
};
