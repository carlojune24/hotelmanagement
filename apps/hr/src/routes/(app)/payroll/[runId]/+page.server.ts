import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import {
	PayrollError,
	acknowledgeRates,
	adjustLine,
	adjustmentSchema,
	generateBatch,
	lockBatch,
	releaseBatch,
	unlockBatch
} from '$lib/server/hr/payroll';
import { runView } from '$lib/server/hr/payroll-view';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	requireCap(locals.user, locals.access, 'payroll:*');
	try {
		return await runView(params.runId);
	} catch (e) {
		if (e instanceof PayrollError) error(404, 'Payroll run not found');
		throw e;
	}
};

const idForm = z.object({ batchId: z.string().uuid() });

function failure(e: unknown) {
	if (e instanceof PayrollError) return fail(400, { error: e.message });
	throw e;
}

async function batchAction(
	event: { request: Request; locals: App.Locals },
	fn: (batchId: string) => Promise<unknown>,
	audit: string
) {
	requireCap(event.locals.user, event.locals.access, 'payroll:*');
	const parsed = idForm.safeParse(Object.fromEntries(await event.request.formData()));
	if (!parsed.success) return fail(400, { error: 'Unknown batch.' });
	try {
		const result = await fn(parsed.data.batchId);
		await writeAudit({
			actor: event.locals.user,
			action: audit,
			entityType: 'payroll_batch',
			entityId: parsed.data.batchId
		});
		return { result };
	} catch (e) {
		return failure(e);
	}
}

/** Shared with the one-establishment focus page (`[batchId]`), which re-exports them. */
export const actions: Actions = {
	generate: async (event) => {
		const out = await batchAction(event, (id) => generateBatch(id), 'payroll.generate');
		if (!('result' in out)) return out;
		const r = out.result as Awaited<ReturnType<typeof generateBatch>>;
		const parts = [`Built ${r.generated} payslip${r.generated === 1 ? '' : 's'}.`];
		if (r.waiting.length) parts.push(`${r.waiting.length} waiting on another establishment's DTR (${r.waiting.map((w) => w.name).join('; ')}).`);
		if (r.noDtr.length) parts.push(`No DTR at all for: ${r.noDtr.join('; ')}.`);
		return { ok: parts.join(' ') };
	},

	adjust: async (event) => {
		requireCap(event.locals.user, event.locals.access, 'payroll:*');
		const parsed = adjustmentSchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the amounts.' });
		try {
			const r = await adjustLine(parsed.data);
			await writeAudit({
				actor: event.locals.user,
				action: 'payroll.adjust',
				entityType: 'payroll_run_line',
				entityId: parsed.data.lineId,
				after: { ...parsed.data, net: r.net }
			});
			return { ok: 'Payslip updated.' };
		} catch (e) {
			return failure(e);
		}
	},

	confirmRates: async ({ params, locals }) => {
		requireCap(locals.user, locals.access, 'payroll:*');
		await acknowledgeRates(params.runId, locals.user!.id);
		await writeAudit({
			actor: locals.user,
			action: 'payroll.rates_confirmed',
			entityType: 'payroll_run',
			entityId: params.runId
		});
		return { ok: 'Rates confirmed for this run.' };
	},

	lock: async (event) => {
		const out = await batchAction(event, (id) => lockBatch(id, event.locals.user!.id), 'payroll.lock');
		return 'result' in out ? { ok: 'Locked. Review, then release to show the payslips.' } : out;
	},

	unlock: async (event) => {
		const out = await batchAction(event, (id) => unlockBatch(id), 'payroll.unlock');
		return 'result' in out ? { ok: 'Unlocked.' } : out;
	},

	release: async (event) => {
		const out = await batchAction(event, (id) => releaseBatch(id, event.locals.user!.id), 'payroll.release');
		return 'result' in out ? { ok: 'Released. Managers can now see these payslips.' } : out;
	}
};
