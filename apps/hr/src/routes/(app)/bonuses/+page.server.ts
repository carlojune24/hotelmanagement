import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { db } from '$lib/server/db/index';
import { establishments } from '$lib/server/db/schema/index';
import { getOrganization } from '$lib/server/establishments';
import {
	BonusError,
	KIND_LABEL,
	KINDS,
	createBatches,
	createSchema,
	deleteDraft,
	issueBatch,
	listBatches,
	refreshBatch,
	reopenBatch,
	setLineAmount
} from '$lib/server/hr/bonuses';
import { TAX_EXEMPT_CENTAVOS } from '$lib/server/hr/thirteenth-month';
import { businessDateFor } from '$lib/server/time';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.access, 'payroll:*');
	const org = await getOrganization();
	const today = businessDateFor('Asia/Manila');
	const parsed = z.coerce.number().int().min(2000).max(2100).safeParse(url.searchParams.get('year'));
	const year = parsed.success ? parsed.data : Number(today.slice(0, 4));
	const [batches, ests] = await Promise.all([
		listBatches(org.id, year),
		db
			.select({ id: establishments.id, name: establishments.name })
			.from(establishments)
			.where(and(eq(establishments.organizationId, org.id), isNull(establishments.deletedAt), eq(establishments.status, 'active')))
			.orderBy(asc(establishments.name))
	]);
	return {
		year,
		today,
		batches,
		establishments: ests,
		kinds: KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] })),
		taxExempt: TAX_EXEMPT_CENTAVOS
	};
};

const fd = async (request: Request) => Object.fromEntries(await request.formData());
const idOnly = z.object({ batchId: z.string().uuid() });

async function act(
	event: { request: Request; locals: App.Locals },
	run: (orgId: string, data: Record<string, FormDataEntryValue>, userId: string) => Promise<{ ok: string; audit: string; entityId?: string; after?: object }>
) {
	requireCap(event.locals.user, event.locals.access, 'payroll:*');
	try {
		const org = await getOrganization();
		const out = await run(org.id, await fd(event.request), event.locals.user!.id);
		await writeAudit({
			actor: event.locals.user,
			action: out.audit,
			entityType: 'bonus_batch',
			entityId: out.entityId,
			after: out.after
		});
		return { ok: out.ok };
	} catch (e) {
		if (e instanceof BonusError) return fail(400, { error: e.message });
		throw e;
	}
}

const bad = (m: string) => new BonusError(m);

export const actions: Actions = {
	create: (event) =>
		act(event, async (org, d, userId) => {
			const p = createSchema.safeParse(d);
			if (!p.success) throw bad(p.error.issues[0]?.message ?? 'Check the details.');
			const r = await createBatches(org, p.data, userId);
			return {
				ok: `${r.created.length} batch${r.created.length === 1 ? '' : 'es'} created${r.skipped.length ? `; already existed for ${r.skipped.join(', ')}` : ''}.`,
				audit: 'bonus.create',
				entityId: r.created[0],
				after: { kind: p.data.kind, year: p.data.year, count: r.created.length }
			};
		}),

	refresh: (event) =>
		act(event, async (org, d) => {
			const p = idOnly.safeParse(d);
			if (!p.success) throw bad('That batch does not exist.');
			await refreshBatch(org, p.data.batchId);
			return { ok: 'Recomputed from the payslips.', audit: 'bonus.refresh', entityId: p.data.batchId };
		}),

	issue: (event) =>
		act(event, async (org, d, userId) => {
			const p = idOnly.safeParse(d);
			if (!p.success) throw bad('That batch does not exist.');
			const r = await issueBatch(org, p.data.batchId, userId);
			return { ok: 'Issued. The amounts are now frozen.', audit: 'bonus.issue', entityId: p.data.batchId, after: { totalCentavos: r.total } };
		}),

	reopen: (event) =>
		act(event, async (org, d) => {
			const p = idOnly.safeParse(d);
			if (!p.success) throw bad('That batch does not exist.');
			await reopenBatch(org, p.data.batchId);
			return { ok: 'Reopened as a draft.', audit: 'bonus.reopen', entityId: p.data.batchId };
		}),

	delete: (event) =>
		act(event, async (org, d) => {
			const p = idOnly.safeParse(d);
			if (!p.success) throw bad('That batch does not exist.');
			const b = await deleteDraft(org, p.data.batchId);
			return { ok: 'Draft deleted.', audit: 'bonus.delete', entityId: p.data.batchId, after: { label: b.label } };
		}),

	amount: (event) =>
		act(event, async (org, d) => {
			const p = z.object({ lineId: z.string().uuid(), amount: z.coerce.number() }).safeParse(d);
			if (!p.success) throw bad('Enter an amount.');
			const b = await setLineAmount(org, p.data.lineId, p.data.amount);
			return { ok: 'Saved.', audit: 'bonus.amount', entityId: b.id, after: { lineId: p.data.lineId, amount: p.data.amount } };
		})
};
