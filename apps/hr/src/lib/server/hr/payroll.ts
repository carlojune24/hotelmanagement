import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
	computePayrollLine,
	computeWithholdingTax,
	dayKindOf,
	type PayrollAdjustments,
	type PayrollDayInput
} from '@mm/hr-core';
import { db } from '$lib/server/db/index';
import {
	calendarDays,
	dtrEntries,
	employeeAssignments,
	employees,
	establishments,
	organizations,
	payrollBatches,
	payrollRunLines,
	payrollRuns,
	schedules
} from '$lib/server/db/schema/index';
import { getHandoff } from './dtr-submissions';
import { parseNightDiff } from './night-diff';

export class PayrollError extends Error {}

export const DAY_FACTORS = [261, 313, 365] as const;
export const FACTOR_LABEL: Record<number, string> = {
	261: '261 days — 5-day week, rest days unpaid',
	313: '313 days — 6-day week, rest day unpaid',
	365: '365 days — every day paid'
};

/** The rates this engine encodes, shown on the run page so a person can check them before locking. */
export const RATES_IN_FORCE = [
	{ name: 'SSS', rule: '15% of the Monthly Salary Credit (₱5,000–₱35,000, ₱500 steps): employee 5%, employer 10%, plus ER-paid EC ₱10/₱30', since: '2025-01-01' },
	{ name: 'PhilHealth', rule: '5% of monthly basic salary (₱10,000 floor, ₱100,000 ceiling), split 50/50', since: '2024-01-01' },
	{ name: 'Pag-IBIG', rule: '2% employee + 2% employer on up to ₱10,000 (max ₱200 each); 1% employee at ₱1,500 and below', since: '2024-02-01' },
	{ name: 'Withholding tax', rule: 'TRAIN per-period table on gross less employee contributions; no year-end true-up', since: '2023-01-01' },
	{ name: 'Premiums', rule: 'OT 125%; rest day / special holiday +30%; regular holiday +100%; OT on those days ×1.3 on top; night differential per establishment setting', since: 'DOLE handbook' }
] as const;

// ---------------------------------------------------------------------------
// Company setting
// ---------------------------------------------------------------------------

export async function getDayFactor(organizationId: string): Promise<number | null> {
	const org = await db
		.select({ config: organizations.config })
		.from(organizations)
		.where(eq(organizations.id, organizationId))
		.then((r) => r.at(0));
	const f = (org?.config as { payroll?: { dayFactor?: number } } | null)?.payroll?.dayFactor;
	return DAY_FACTORS.includes(f as never) ? (f as number) : null;
}

export async function saveDayFactor(organizationId: string, dayFactor: number) {
	if (!DAY_FACTORS.includes(dayFactor as never)) throw new PayrollError('Choose 261, 313 or 365.');
	const org = await db
		.select({ config: organizations.config })
		.from(organizations)
		.where(eq(organizations.id, organizationId))
		.then((r) => r.at(0));
	if (!org) throw new PayrollError('Organization not found.');
	const config = { ...(org.config as object), payroll: { dayFactor } };
	await db.update(organizations).set({ config, updatedAt: new Date() }).where(eq(organizations.id, organizationId));
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.');
export const runFormSchema = z
	.object({
		cutoffStart: date,
		cutoffEnd: date,
		payDate: date,
		frequency: z.enum(['semi_monthly', 'monthly'])
	})
	.refine((v) => v.cutoffEnd >= v.cutoffStart, { path: ['cutoffEnd'], message: 'The cutoff ends before it starts.' })
	.refine(
		(v) => (Date.parse(v.cutoffEnd) - Date.parse(v.cutoffStart)) / 86_400_000 <= 31,
		{ path: ['cutoffEnd'], message: 'A cutoff is at most 31 days.' }
	);
export type RunForm = z.infer<typeof runFormSchema>;

export async function createRun(organizationId: string, input: RunForm, userId: string | null) {
	const dayFactor = await getDayFactor(organizationId);
	if (!dayFactor) {
		throw new PayrollError('Set the working-day factor under Payroll settings first — pay rates depend on it.');
	}
	// Never let one cutoff be paid twice.
	const overlap = await db
		.select({ id: payrollRuns.id })
		.from(payrollRuns)
		.where(
			and(
				eq(payrollRuns.organizationId, organizationId),
				lte(payrollRuns.cutoffStart, input.cutoffEnd),
				gte(payrollRuns.cutoffEnd, input.cutoffStart)
			)
		)
		.then((r) => r.at(0));
	if (overlap) throw new PayrollError('Another payroll run already covers some of those dates.');

	const [run] = await db
		.insert(payrollRuns)
		.values({ organizationId, ...input, dayFactor, createdByUserId: userId })
		.returning();
	await ensureBatches(run!.id, organizationId);
	return run!;
}

/**
 * One batch per active establishment, created on demand. Done when a run is opened (not only at
 * creation) so an establishment added later still gets a batch, and written as a single
 * insert-select that tolerates an establishment disappearing between the read and the write.
 */
export async function ensureBatches(runId: string, organizationId: string) {
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			await db.execute(sql`
				insert into payroll_batches (run_id, establishment_id)
				select ${runId}, e.id from establishments e
				where e.organization_id = ${organizationId} and e.deleted_at is null and e.status = 'active'
				on conflict (run_id, establishment_id) do nothing`);
			return;
		} catch (e) {
			// 23503 = foreign_key_violation: an establishment was removed under us — read again.
			if ((e as { code?: string }).code !== '23503' || attempt === 2) throw e;
		}
	}
}

export async function listRuns(organizationId: string) {
	const runs = await db
		.select()
		.from(payrollRuns)
		.where(eq(payrollRuns.organizationId, organizationId))
		.orderBy(desc(payrollRuns.cutoffStart));
	if (runs.length === 0) return [];
	const batches = await db
		.select({ runId: payrollBatches.runId, status: payrollBatches.status })
		.from(payrollBatches)
		.where(inArray(payrollBatches.runId, runs.map((r) => r.id)));
	return runs.map((r) => {
		const mine = batches.filter((b) => b.runId === r.id);
		return {
			...r,
			batchCount: mine.length,
			released: mine.filter((b) => b.status === 'released').length,
			locked: mine.filter((b) => b.status === 'locked').length
		};
	});
}

/** Calendar months a cutoff touches, as `YYYY-MM`. */
function monthsOf(start: string, end: string): string[] {
	const out: string[] = [];
	let [y, m] = start.split('-').map(Number) as [number, number];
	const [ey, em] = end.split('-').map(Number) as [number, number];
	while (y < ey || (y === ey && m <= em)) {
		out.push(`${y}-${String(m).padStart(2, '0')}`);
		m += 1;
		if (m > 12) {
			m = 1;
			y += 1;
		}
	}
	return out;
}

export async function getRun(runId: string) {
	const run = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).then((r) => r.at(0));
	if (!run) throw new PayrollError('Payroll run not found.');
	await ensureBatches(run.id, run.organizationId);
	const rows = await db
		.select({
			batch: payrollBatches,
			name: establishments.name,
			slug: establishments.slug
		})
		.from(payrollBatches)
		.innerJoin(establishments, eq(establishments.id, payrollBatches.establishmentId))
		.where(eq(payrollBatches.runId, runId))
		.orderBy(asc(establishments.name));
	const lines = await db
		.select({
			batchId: payrollRunLines.batchId,
			gross: payrollRunLines.grossCentavos,
			net: payrollRunLines.netPayCentavos
		})
		.from(payrollRunLines)
		.where(eq(payrollRunLines.runId, runId));

	const months = monthsOf(run.cutoffStart, run.cutoffEnd);
	const batches = await Promise.all(
		rows.map(async (r) => {
			const dtr = await Promise.all(months.map((m) => getHandoff(r.batch.establishmentId, m)));
			const mine = lines.filter((l) => l.batchId === r.batch.id);
			return {
				id: r.batch.id,
				establishmentId: r.batch.establishmentId,
				establishmentName: r.name,
				establishmentSlug: r.slug,
				status: r.batch.status as 'draft' | 'locked' | 'released',
				generatedAt: r.batch.generatedAt,
				releasedAt: r.batch.releasedAt,
				dtrReceived: dtr.every((d) => d.status === 'received'),
				dtrStatuses: dtr.map((d) => ({ month: d.month, status: d.status })),
				count: mine.length,
				gross: mine.reduce((s, l) => s + l.gross, 0),
				net: mine.reduce((s, l) => s + l.net, 0)
			};
		})
	);
	return { run, batches };
}

export async function acknowledgeRates(runId: string, userId: string | null) {
	await db
		.update(payrollRuns)
		.set({ ratesCheckedByUserId: userId, ratesCheckedAt: new Date(), updatedAt: new Date() })
		.where(eq(payrollRuns.id, runId));
}

// ---------------------------------------------------------------------------
// Generating a batch
// ---------------------------------------------------------------------------

export interface GenerateResult {
	generated: number;
	/** People whose pay needs another establishment's DTR to be received first. */
	waiting: Array<{ name: string; establishments: string[] }>;
	/** People assigned here with no DTR at all in the cutoff — never silently paid or zeroed. */
	noDtr: string[];
}

const adjustmentsOf = (raw: unknown): PayrollAdjustments => {
	const a = (raw ?? {}) as Partial<PayrollAdjustments>;
	return {
		allowancesCentavos: a.allowancesCentavos ?? 0,
		otherEarningsCentavos: a.otherEarningsCentavos ?? 0,
		cashAdvanceCentavos: a.cashAdvanceCentavos ?? 0,
		loansCentavos: a.loansCentavos ?? 0,
		otherDeductionsCentavos: a.otherDeductionsCentavos ?? 0,
		withholdingOverrideCentavos: a.withholdingOverrideCentavos ?? null
	};
};

export async function generateBatch(batchId: string): Promise<GenerateResult> {
	const batch = await db.select().from(payrollBatches).where(eq(payrollBatches.id, batchId)).then((r) => r.at(0));
	if (!batch) throw new PayrollError('That payroll batch does not exist.');
	if (batch.status !== 'draft') throw new PayrollError('This batch is locked. Unlock it to regenerate.');
	const run = await db.select().from(payrollRuns).where(eq(payrollRuns.id, batch.runId)).then((r) => r.at(0));
	if (!run) throw new PayrollError('Payroll run not found.');
	const est = await db.select().from(establishments).where(eq(establishments.id, batch.establishmentId)).then((r) => r.at(0));
	if (!est) throw new PayrollError('Establishment not found.');

	const months = monthsOf(run.cutoffStart, run.cutoffEnd);
	for (const m of months) {
		if ((await getHandoff(est.id, m)).status !== 'received') {
			throw new PayrollError(
				`${est.name}'s DTR for ${m} has not been received yet — payroll is built from received DTRs only.`
			);
		}
	}

	// Everyone with an assignment here during the cutoff, and every assignment they held then.
	const overlapsCutoff = and(
		lte(employeeAssignments.startDate, run.cutoffEnd),
		or(isNull(employeeAssignments.endDate), gte(employeeAssignments.endDate, run.cutoffStart))
	);
	const hereRows = await db
		.select({ employeeId: employeeAssignments.employeeId })
		.from(employeeAssignments)
		.where(and(eq(employeeAssignments.establishmentId, est.id), overlapsCutoff));
	const candidateIds = [...new Set(hereRows.map((r) => r.employeeId))];
	if (candidateIds.length === 0) {
		await db.delete(payrollRunLines).where(eq(payrollRunLines.batchId, batchId));
		await db.update(payrollBatches).set({ generatedAt: new Date(), updatedAt: new Date() }).where(eq(payrollBatches.id, batchId));
		return { generated: 0, waiting: [], noDtr: [] };
	}

	const [people, assignments, entries, existing] = await Promise.all([
		db.select().from(employees).where(and(inArray(employees.id, candidateIds), isNull(employees.deletedAt))),
		db
			.select()
			.from(employeeAssignments)
			.where(and(inArray(employeeAssignments.employeeId, candidateIds), overlapsCutoff)),
		db
			.select({ e: dtrEntries, restDay: schedules.isRestDay })
			.from(dtrEntries)
			.leftJoin(schedules, eq(schedules.id, dtrEntries.scheduleId))
			.where(
				and(
					inArray(dtrEntries.employeeId, candidateIds),
					gte(dtrEntries.date, run.cutoffStart),
					lte(dtrEntries.date, run.cutoffEnd),
					isNull(dtrEntries.deletedAt)
				)
			),
		db.select().from(payrollRunLines).where(eq(payrollRunLines.batchId, batchId))
	]);

	const estIds = [...new Set([est.id, ...assignments.map((a) => a.establishmentId), ...entries.map((e) => e.e.establishmentId)])];
	const [estRows, holidays] = await Promise.all([
		db.select().from(establishments).where(inArray(establishments.id, estIds)),
		db
			.select()
			.from(calendarDays)
			.where(
				and(
					inArray(calendarDays.establishmentId, estIds),
					gte(calendarDays.date, run.cutoffStart),
					lte(calendarDays.date, run.cutoffEnd),
					eq(calendarDays.status, 'approved')
				)
			)
	]);
	const estById = new Map(estRows.map((e) => [e.id, e]));
	const holidayAt = new Map(holidays.map((h) => [`${h.establishmentId}|${h.date}`, h.kind]));
	const keptAdjustments = new Map(existing.map((l) => [l.employeeId, l.adjustments]));

	const waiting: GenerateResult['waiting'] = [];
	const noDtr: string[] = [];
	const received = new Map<string, boolean>();
	const isReceived = async (estId: string) => {
		if (!received.has(estId)) {
			const all = await Promise.all(months.map((m) => getHandoff(estId, m)));
			received.set(estId, all.every((h) => h.status === 'received'));
		}
		return received.get(estId)!;
	};

	type Built = { employee: (typeof people)[number]; line: ReturnType<typeof computePayrollLine>; cost: Record<string, number>; minutes: { regular: number; ot: number; night: number } };
	const built: Built[] = [];

	for (const emp of people) {
		const mineEntries = entries.filter((e) => e.e.employeeId === emp.id);
		const mineAssignments = assignments.filter((a) => a.employeeId === emp.id);

		// Home for this run: the flagged primary among the assignments held in the cutoff, else the
		// establishment where they logged the most time. Only the home's batch pays them.
		const minutesAt = new Map<string, number>();
		for (const e of mineEntries) minutesAt.set(e.e.establishmentId, (minutesAt.get(e.e.establishmentId) ?? 0) + e.e.workedMinutes);
		const primary = mineAssignments.find((a) => a.isPrimary);
		const busiest = [...minutesAt.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
		const home = primary?.establishmentId ?? busiest ?? mineAssignments[0]?.establishmentId;
		if (home !== est.id) continue;

		const name = `${emp.lastName}, ${emp.firstName}`;
		if (mineEntries.length === 0) {
			noDtr.push(name);
			continue;
		}
		const sites = [...new Set(mineEntries.map((e) => e.e.establishmentId))];
		const pending: string[] = [];
		for (const s of sites) if (!(await isReceived(s))) pending.push(estById.get(s)?.name ?? 'another establishment');
		if (pending.length) {
			waiting.push({ name, establishments: pending });
			continue;
		}

		const days: PayrollDayInput[] = mineEntries
			.sort((a, b) => a.e.date.localeCompare(b.e.date))
			.map(({ e, restDay }) => ({
				date: e.date,
				dayKind: dayKindOf({ isRestDay: restDay ?? false, holiday: holidayAt.get(`${e.establishmentId}|${e.date}`) ?? null }),
				scheduledWorkday: e.scheduleId !== null && restDay === false,
				workedMinutes: e.workedMinutes,
				creditMinutes: e.leaveMinutes,
				otMinutes: e.otMinutes,
				unapprovedOtMinutes: e.unapprovedOtMinutes,
				nightDiffMinutes: e.nightDiffMinutes,
				tardinessMinutes: e.tardinessMinutes,
				undertimeMinutes: e.undertimeMinutes,
				punched: e.timeIn !== null && e.timeOut !== null
			}));

		const nd = parseNightDiff(estById.get(home)?.config);
		const computed = computePayrollLine({
			personRef: emp.personRef,
			costCenter: emp.costCenter,
			payBasis: emp.payBasis as 'monthly' | 'daily' | 'hourly',
			baseRateCentavos: emp.baseRateCentavos,
			frequency: run.frequency as 'semi_monthly' | 'monthly',
			dayFactor: run.dayFactor,
			nightDiffRate: nd.ratePct / 100,
			days,
			adjustments: adjustmentsOf(keptAdjustments.get(emp.id))
		});

		// Cost by establishment: gross split by time worked at each, remainder to the home.
		const total = [...minutesAt.values()].reduce((a, b) => a + b, 0);
		const cost: Record<string, number> = {};
		let assigned = 0;
		for (const [estId, mins] of minutesAt) {
			if (estId === home) continue;
			const share = total > 0 ? Math.floor((computed.line.gross * mins) / total) : 0;
			if (share > 0) {
				cost[estId] = share;
				assigned += share;
			}
		}
		cost[home] = computed.line.gross - assigned;

		built.push({
			employee: emp,
			line: computed,
			cost,
			minutes: {
				regular: mineEntries.reduce((s, e) => s + Math.max(0, e.e.workedMinutes - e.e.otMinutes - e.e.unapprovedOtMinutes), 0),
				ot: mineEntries.reduce((s, e) => s + e.e.otMinutes, 0),
				night: mineEntries.reduce((s, e) => s + e.e.nightDiffMinutes, 0)
			}
		});
	}

	await db.transaction(async (tx) => {
		await tx.delete(payrollRunLines).where(eq(payrollRunLines.batchId, batchId));
		if (built.length > 0) {
			await tx.insert(payrollRunLines).values(
				built.map((b) => ({
					runId: run.id,
					batchId,
					employeeId: b.employee.id,
					establishmentId: est.id,
					personRef: b.employee.personRef,
					employeeNo: b.employee.employeeNo,
					employeeName: `${b.employee.lastName}, ${b.employee.firstName}${b.employee.middleName ? ` ${b.employee.middleName.charAt(0)}.` : ''}`,
					position: assignments.find((a) => a.employeeId === b.employee.id && a.establishmentId === est.id)?.position ?? '',
					department: assignments.find((a) => a.employeeId === b.employee.id && a.establishmentId === est.id)?.department ?? null,
					payBasis: b.employee.payBasis,
					baseRateCentavos: b.employee.baseRateCentavos,
					govIds: b.employee.govIds,
					daysWorked: b.line.line.days_worked,
					minutesRegular: b.minutes.regular,
					minutesOvertime: b.minutes.ot,
					minutesNightDiff: b.minutes.night,
					earnings: b.line.line.earnings,
					grossCentavos: b.line.line.gross,
					deductions: b.line.line.deductions,
					employerContributions: b.line.line.employer_contributions,
					netPayCentavos: b.line.line.net_pay,
					thirteenthMonthAccrualCentavos: b.line.line.thirteenth_month_accrual,
					adjustments: adjustmentsOf(keptAdjustments.get(b.employee.id)),
					detail: b.line.detail,
					costByEstablishment: b.cost
				}))
			);
		}
		await tx.update(payrollBatches).set({ generatedAt: new Date(), updatedAt: new Date() }).where(eq(payrollBatches.id, batchId));
	});

	return { generated: built.length, waiting, noDtr };
}

// ---------------------------------------------------------------------------
// Reviewing, adjusting, locking, releasing
// ---------------------------------------------------------------------------

export const adjustmentSchema = z.object({
	lineId: z.string().uuid(),
	allowances: z.coerce.number().min(0).max(10_000_000).default(0),
	otherEarnings: z.coerce.number().min(0).max(10_000_000).default(0),
	cashAdvance: z.coerce.number().min(0).max(10_000_000).default(0),
	loans: z.coerce.number().min(0).max(10_000_000).default(0),
	otherDeductions: z.coerce.number().min(0).max(10_000_000).default(0),
	/** Blank = use the computed tax. */
	withholdingOverride: z.preprocess(
		(v) => (v === '' || v === null || v === undefined ? null : v),
		z.coerce.number().min(0).max(10_000_000).nullable()
	)
});

const centavos = (pesos: number) => Math.round(pesos * 100);

/** Re-prices one line from the figures already stored, with Main HR's adjustments applied. */
export async function adjustLine(input: z.infer<typeof adjustmentSchema>) {
	const row = await db
		.select({ line: payrollRunLines, batch: payrollBatches, run: payrollRuns })
		.from(payrollRunLines)
		.innerJoin(payrollBatches, eq(payrollBatches.id, payrollRunLines.batchId))
		.innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunLines.runId))
		.where(eq(payrollRunLines.id, input.lineId))
		.then((r) => r.at(0));
	if (!row) throw new PayrollError('That payslip line does not exist.');
	if (row.batch.status !== 'draft') throw new PayrollError('This batch is locked. Unlock it to adjust.');

	const adjustments: PayrollAdjustments = {
		allowancesCentavos: centavos(input.allowances),
		otherEarningsCentavos: centavos(input.otherEarnings),
		cashAdvanceCentavos: centavos(input.cashAdvance),
		loansCentavos: centavos(input.loans),
		otherDeductionsCentavos: centavos(input.otherDeductions),
		withholdingOverrideCentavos: input.withholdingOverride === null ? null : centavos(input.withholdingOverride)
	};
	// Adjustments only touch their own lines; recompute the totals from the stored components.
	const l = row.line;
	const earnings = {
		...(l.earnings as Record<string, number>),
		allowances: adjustments.allowancesCentavos,
		other: adjustments.otherEarningsCentavos
	};
	const gross = Object.values(earnings).reduce((a, b) => a + b, 0);
	const stored = l.deductions as Record<string, number>;
	const detail = l.detail as { taxableCentavos?: number };
	// Taxable moves with gross: recompute withholding unless an override was given.
	const fixedEe = (stored.sss_ee ?? 0) + (stored.philhealth_ee ?? 0) + (stored.pagibig_ee ?? 0);
	const taxable = Math.max(0, gross - fixedEe);
	const withholding =
		adjustments.withholdingOverrideCentavos !== null
			? adjustments.withholdingOverrideCentavos
			: computeWithholdingTax(taxable, row.run.frequency as 'semi_monthly' | 'monthly');
	const deductions = {
		...stored,
		withholding_tax: withholding,
		cash_advance: adjustments.cashAdvanceCentavos,
		loans: adjustments.loansCentavos,
		other: adjustments.otherDeductionsCentavos
	};
	const net = gross - Object.values(deductions).reduce((a, b) => a + b, 0);

	await db
		.update(payrollRunLines)
		.set({
			earnings,
			grossCentavos: gross,
			deductions,
			netPayCentavos: net,
			adjustments,
			detail: { ...detail, taxableCentavos: taxable },
			updatedAt: new Date()
		})
		.where(eq(payrollRunLines.id, l.id));
	return { net, gross };
}

export async function listBatchLines(batchId: string) {
	return db.select().from(payrollRunLines).where(eq(payrollRunLines.batchId, batchId)).orderBy(asc(payrollRunLines.employeeName));
}

export async function lockBatch(batchId: string, userId: string | null) {
	const row = await db
		.select({ batch: payrollBatches, run: payrollRuns })
		.from(payrollBatches)
		.innerJoin(payrollRuns, eq(payrollRuns.id, payrollBatches.runId))
		.where(eq(payrollBatches.id, batchId))
		.then((r) => r.at(0));
	if (!row) throw new PayrollError('That payroll batch does not exist.');
	if (row.batch.status !== 'draft') throw new PayrollError('This batch is already locked.');
	if (!row.run.ratesCheckedAt) {
		throw new PayrollError('Confirm the statutory rates for this period before locking.');
	}
	if (!row.batch.generatedAt) throw new PayrollError('Generate the payroll before locking it.');
	await db
		.update(payrollBatches)
		.set({ status: 'locked', lockedByUserId: userId, lockedAt: new Date(), updatedAt: new Date() })
		.where(eq(payrollBatches.id, batchId));
	return row.batch;
}

export async function unlockBatch(batchId: string) {
	const [row] = await db
		.update(payrollBatches)
		.set({ status: 'draft', lockedByUserId: null, lockedAt: null, updatedAt: new Date() })
		.where(and(eq(payrollBatches.id, batchId), eq(payrollBatches.status, 'locked')))
		.returning();
	if (!row) throw new PayrollError('Only a locked, unreleased batch can be unlocked.');
	return row;
}

/** Makes the payslips visible to the establishment's managers. */
export async function releaseBatch(batchId: string, userId: string | null) {
	const [row] = await db
		.update(payrollBatches)
		.set({ status: 'released', releasedByUserId: userId, releasedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(payrollBatches.id, batchId), eq(payrollBatches.status, 'locked')))
		.returning();
	if (!row) throw new PayrollError('Lock the batch before releasing it.');
	return row;
}

export async function getLine(lineId: string) {
	return db
		.select({
			line: payrollRunLines,
			batchStatus: payrollBatches.status,
			run: payrollRuns,
			establishmentName: establishments.name
		})
		.from(payrollRunLines)
		.innerJoin(payrollBatches, eq(payrollBatches.id, payrollRunLines.batchId))
		.innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunLines.runId))
		.innerJoin(establishments, eq(establishments.id, payrollRunLines.establishmentId))
		.where(eq(payrollRunLines.id, lineId))
		.then((r) => r.at(0) ?? null);
}

/** Released payslips for the people whose home is this establishment, newest cutoff first. */
export async function releasedPayslipsFor(establishmentId: string) {
	return db
		.select({
			id: payrollRunLines.id,
			employeeName: payrollRunLines.employeeName,
			employeeNo: payrollRunLines.employeeNo,
			position: payrollRunLines.position,
			netPayCentavos: payrollRunLines.netPayCentavos,
			cutoffStart: payrollRuns.cutoffStart,
			cutoffEnd: payrollRuns.cutoffEnd,
			payDate: payrollRuns.payDate,
			releasedAt: payrollBatches.releasedAt
		})
		.from(payrollRunLines)
		.innerJoin(payrollBatches, eq(payrollBatches.id, payrollRunLines.batchId))
		.innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunLines.runId))
		.where(and(eq(payrollRunLines.establishmentId, establishmentId), eq(payrollBatches.status, 'released')))
		.orderBy(desc(payrollRuns.cutoffStart), asc(payrollRunLines.employeeName));
}

/** Masks a government number to its last four characters for a payslip. */
export function maskId(value: string | undefined | null): string {
	if (!value) return '—';
	const v = value.replace(/\s/g, '');
	return v.length <= 4 ? v : `${'•'.repeat(v.length - 4)}${v.slice(-4)}`;
}

