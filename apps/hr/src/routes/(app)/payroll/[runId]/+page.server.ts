import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import {
	PayrollError,
	RATES_IN_FORCE,
	acknowledgeRates,
	adjustLine,
	adjustmentSchema,
	generateBatch,
	getRun,
	listBatchLines,
	lockBatch,
	releaseBatch,
	unlockBatch
} from '$lib/server/hr/payroll';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	requireCap(locals.user, locals.access, 'payroll:*');
	let data;
	try {
		data = await getRun(params.runId);
	} catch (e) {
		if (e instanceof PayrollError) error(404, 'Payroll run not found');
		throw e;
	}
	const lines = await Promise.all(
		data.batches.map(async (b) => [b.id, await listBatchLines(b.id)] as const)
	);
	const byBatch = new Map(lines);
	const estName = new Map(data.batches.map((b) => [b.establishmentId, b.establishmentName]));

	return {
		run: {
			id: data.run.id,
			cutoffStart: data.run.cutoffStart,
			cutoffEnd: data.run.cutoffEnd,
			payDate: data.run.payDate,
			frequency: data.run.frequency,
			dayFactor: data.run.dayFactor,
			ratesCheckedAt: data.run.ratesCheckedAt
		},
		rates: RATES_IN_FORCE,
		batches: data.batches.map((b) => ({
			...b,
			lines: (byBatch.get(b.id) ?? []).map((l) => {
				const earnings = l.earnings as Record<string, number>;
				const deductions = l.deductions as Record<string, number>;
				const adj = l.adjustments as Record<string, number | null>;
				return {
					id: l.id,
					employeeName: l.employeeName,
					employeeNo: l.employeeNo,
					position: l.position,
					daysWorked: l.daysWorked,
					basic: earnings.basic ?? 0,
					overtime: earnings.overtime ?? 0,
					premium: (earnings.holiday_premium ?? 0) + (earnings.night_diff ?? 0),
					extras: (earnings.allowances ?? 0) + (earnings.other ?? 0),
					gross: l.grossCentavos,
					statutory: (deductions.sss_ee ?? 0) + (deductions.philhealth_ee ?? 0) + (deductions.pagibig_ee ?? 0),
					tax: deductions.withholding_tax ?? 0,
					other: (deductions.cash_advance ?? 0) + (deductions.loans ?? 0) + (deductions.tardiness_undertime ?? 0) + (deductions.other ?? 0),
					net: l.netPayCentavos,
					loans: ((l.detail as { loans?: Array<{ label: string; due: number; deducted: number }> } | null)?.loans ?? []).map(
						(x) => ({ label: x.label, due: x.due, deducted: x.deducted })
					),
					sharedWith: Object.keys(l.costByEstablishment as Record<string, number>)
						.filter((id) => id !== l.establishmentId)
						.map((id) => estName.get(id) ?? 'another establishment'),
					adjustments: {
						allowances: (adj.allowancesCentavos ?? 0) / 100,
						otherEarnings: (adj.otherEarningsCentavos ?? 0) / 100,
						cashAdvance: (adj.cashAdvanceCentavos ?? 0) / 100,
						otherDeductions: (adj.otherDeductionsCentavos ?? 0) / 100,
						withholdingOverride: adj.withholdingOverrideCentavos == null ? '' : String((adj.withholdingOverrideCentavos as number) / 100)
					}
				};
			})
		}))
	};
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
