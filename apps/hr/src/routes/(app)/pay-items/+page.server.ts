import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { getOrganization } from '$lib/server/establishments';
import { loanableEmployees } from '$lib/server/hr/loans';
import { listRuns } from '$lib/server/hr/payroll';
import {
	PayItemError,
	archivePayItem,
	createPayItems,
	listPayItems,
	payItemEditSchema,
	payItemSchema,
	updatePayItem,
	voidPayItem
} from '$lib/server/hr/pay-items';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.access, 'payroll:*');
	const org = await getOrganization();
	const [items, people, runs] = await Promise.all([listPayItems(org.id), loanableEmployees(org.id), listRuns(org.id)]);
	return { items, people, cutoffs: runs.map((r) => ({ start: r.cutoffStart, end: r.cutoffEnd })) };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'payroll:*');
		const fd = await request.formData();
		const parsed = payItemSchema.safeParse({
			employeeIds: fd.getAll('employeeId').map(String),
			kind: fd.get('kind'),
			category: fd.get('category'),
			label: fd.get('label'),
			amount: fd.get('amount'),
			recurring: fd.get('recurring') === 'on',
			exempt: fd.get('exempt') === 'on',
			startDate: fd.get('startDate'),
			endDate: fd.get('endDate'),
			note: fd.get('note') ?? ''
		});
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the form.' });
		try {
			const org = await getOrganization();
			const r = await createPayItems(org.id, parsed.data, locals.user!.id);
			for (const c of r.created) {
				await writeAudit({
					actor: locals.user,
					action: 'pay_item.create',
					entityType: 'pay_item',
					entityId: c.id,
					after: { employeeId: c.employeeId, kind: parsed.data.kind, label: parsed.data.label, amount: parsed.data.amount }
				});
			}
			const n = r.created.length;
			return {
				ok: `Added ${n} item${n === 1 ? '' : 's'}.${r.reflected ? ` ${r.reflected} draft payslip${r.reflected === 1 ? '' : 's'} updated.` : ''}`
			};
		} catch (e) {
			if (e instanceof PayItemError) return fail(400, { error: e.message });
			throw e;
		}
	},

	update: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'payroll:*');
		const fd = await request.formData();
		const parsed = payItemEditSchema.safeParse({
			id: fd.get('id'),
			category: fd.get('category'),
			label: fd.get('label'),
			amount: fd.get('amount'),
			recurring: fd.get('recurring') === 'on',
			exempt: fd.get('exempt') === 'on',
			startDate: fd.get('startDate'),
			endDate: fd.get('endDate'),
			note: fd.get('note') ?? ''
		});
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the form.' });
		try {
			const org = await getOrganization();
			const r = await updatePayItem(org.id, parsed.data);
			await writeAudit({
				actor: locals.user,
				action: 'pay_item.update',
				entityType: 'pay_item',
				entityId: r.after.id,
				before: { label: r.before.label, amountCentavos: r.before.amountCentavos, category: r.before.category, startDate: r.before.startDate, endDate: r.before.endDate, taxable: r.before.taxable },
				after: { label: r.after.label, amountCentavos: r.after.amountCentavos, category: r.after.category, startDate: r.after.startDate, endDate: r.after.endDate, taxable: r.after.taxable }
			});
			return { ok: `Saved.${r.reflected ? ` ${r.reflected} draft payslip${r.reflected === 1 ? '' : 's'} updated.` : ''}` };
		} catch (e) {
			if (e instanceof PayItemError) return fail(400, { error: e.message });
			throw e;
		}
	},

	archive: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'payroll:*');
		const parsed = z
			.object({ id: z.string().uuid(), restore: z.string().optional() })
			.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: 'That item could not be found.' });
		const restore = parsed.data.restore === '1';
		try {
			const org = await getOrganization();
			await archivePayItem(org.id, parsed.data.id, !restore);
			await writeAudit({
				actor: locals.user,
				action: restore ? 'pay_item.restore' : 'pay_item.archive',
				entityType: 'pay_item',
				entityId: parsed.data.id
			});
			return { ok: restore ? 'Item restored.' : 'Item archived.' };
		} catch (e) {
			if (e instanceof PayItemError) return fail(400, { error: e.message });
			throw e;
		}
	},

	void: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'payroll:*');
		const parsed = z
			.object({ id: z.string().uuid(), reason: z.string().trim().max(200).default('') })
			.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: 'That item could not be found.' });
		try {
			await voidPayItem(parsed.data.id, parsed.data.reason);
			await writeAudit({
				actor: locals.user,
				action: 'pay_item.void',
				entityType: 'pay_item',
				entityId: parsed.data.id,
				after: { reason: parsed.data.reason }
			});
			return { ok: 'Item voided.' };
		} catch (e) {
			if (e instanceof PayItemError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
