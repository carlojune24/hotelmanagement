import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import {
	organizations,
	payrollBatches,
	payrollRunLines,
	payrollRuns,
	remittances,
	type Remittance
} from '$lib/server/db/schema/index';

export class RemittanceError extends Error {}

export const AGENCIES = ['sss', 'philhealth', 'pagibig', 'bir'] as const;
export type Agency = (typeof AGENCIES)[number];
export const AGENCY_LABEL: Record<Agency, string> = {
	sss: 'SSS',
	philhealth: 'PhilHealth',
	pagibig: 'Pag-IBIG',
	bir: 'BIR (withholding tax)'
};
/** Which key of a person's government IDs each agency is filed under. */
const ID_KEY: Record<Agency, 'sss' | 'philhealth' | 'pagibig' | 'tin'> = {
	sss: 'sss',
	philhealth: 'philhealth',
	pagibig: 'pagibig',
	bir: 'tin'
};

export const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Pick a month.');
export const agencySchema = z.enum(AGENCIES);

// ---------------------------------------------------------------------------
// Pure: payroll lines → one agency's monthly schedule
// ---------------------------------------------------------------------------

export interface ScheduleLine {
	employeeId: string;
	employeeName: string;
	employeeNo: string;
	establishmentId: string;
	govIds: unknown;
	deductions: unknown;
	employerContributions: unknown;
	/** Snapshot taken when the payslip was generated. */
	coverage?: { sss?: boolean; philhealth?: boolean; pagibig?: boolean; withholdingExempt?: boolean; note?: string | null };
}

export interface ScheduleRow {
	employeeId: string;
	name: string;
	employeeNo: string;
	idNumber: string | null;
	employee: number;
	employer: number;
	ec: number;
	total: number;
}

export interface Totals {
	employee: number;
	employer: number;
	ec: number;
	total: number;
}

export interface Schedule {
	agency: Agency;
	rows: ScheduleRow[];
	totals: Totals;
	byEstablishment: Record<string, Totals>;
	/** Paid something but has no number on file for this agency. */
	missingId: string[];
	/** Left out on purpose — covered-by-nobody / exempt — with Main HR's reason. */
	notCovered: Array<{ name: string; note: string | null }>;
}

const num = (o: unknown, k: string) => {
	const v = (o as Record<string, unknown> | null)?.[k];
	return typeof v === 'number' ? v : 0;
};
const str = (o: unknown, k: string) => {
	const v = (o as Record<string, unknown> | null)?.[k];
	return typeof v === 'string' && v.trim() ? v.trim() : null;
};

function shares(agency: Agency, l: ScheduleLine) {
	switch (agency) {
		case 'sss':
			return { employee: num(l.deductions, 'sss_ee'), employer: num(l.employerContributions, 'sss_er'), ec: num(l.employerContributions, 'ecc') };
		case 'philhealth':
			return { employee: num(l.deductions, 'philhealth_ee'), employer: num(l.employerContributions, 'philhealth_er'), ec: 0 };
		case 'pagibig':
			return { employee: num(l.deductions, 'pagibig_ee'), employer: num(l.employerContributions, 'pagibig_er'), ec: 0 };
		case 'bir':
			return { employee: num(l.deductions, 'withholding_tax'), employer: 0, ec: 0 };
	}
}

const emptyTotals = (): Totals => ({ employee: 0, employer: 0, ec: 0, total: 0 });
const add = (t: Totals, s: { employee: number; employer: number; ec: number }) => {
	t.employee += s.employee;
	t.employer += s.employer;
	t.ec += s.ec;
	t.total += s.employee + s.employer + s.ec;
};

/** One agency's schedule: per person across every run in the month, plus the per-establishment split. */
export function buildSchedule(agency: Agency, lines: ScheduleLine[]): Schedule {
	const people = new Map<string, ScheduleRow>();
	const byEstablishment: Record<string, Totals> = {};
	const totals = emptyTotals();
	const notCovered = new Map<string, { name: string; note: string | null }>();

	for (const l of lines) {
		const covered =
			agency === 'bir' ? l.coverage?.withholdingExempt !== true : l.coverage?.[agency] !== false;
		if (!covered) notCovered.set(l.employeeId, { name: l.employeeName, note: l.coverage?.note ?? null });

		const s = shares(agency, l);
		if (s.employee + s.employer + s.ec === 0) continue;
		const row =
			people.get(l.employeeId) ??
			({
				employeeId: l.employeeId,
				name: l.employeeName,
				employeeNo: l.employeeNo,
				idNumber: str(l.govIds, ID_KEY[agency]),
				employee: 0,
				employer: 0,
				ec: 0,
				total: 0
			} satisfies ScheduleRow);
		row.employee += s.employee;
		row.employer += s.employer;
		row.ec += s.ec;
		row.total += s.employee + s.employer + s.ec;
		people.set(l.employeeId, row);
		add(totals, s);
		add((byEstablishment[l.establishmentId] ??= emptyTotals()), s);
	}

	const rows = [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
	return {
		agency,
		rows,
		totals,
		byEstablishment,
		missingId: rows.filter((r) => !r.idNumber).map((r) => r.name),
		notCovered: [...notCovered.values()].sort((a, b) => a.name.localeCompare(b.name))
	};
}

/** Pure: the due date for a `YYYY-MM` period when the agency's deadline is "day N of the next month". */
export function dueDateFor(period: string, dayOfNextMonth: number | null | undefined): string | null {
	if (!dayOfNextMonth || dayOfNextMonth < 1 || dayOfNextMonth > 31) return null;
	const [y, m] = period.split('-').map(Number) as [number, number];
	const ny = m === 12 ? y + 1 : y;
	const nm = m === 12 ? 1 : m + 1;
	const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
	return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(dayOfNextMonth, last)).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Settings — employer numbers and the company's deadline rules
// ---------------------------------------------------------------------------

const settingsSchema = z.object({
	employerIds: z.object({ sss: z.string().optional(), philhealth: z.string().optional(), pagibig: z.string().optional() }).default({}),
	dueDay: z
		.object({
			sss: z.number().int().min(1).max(31).nullable().optional(),
			philhealth: z.number().int().min(1).max(31).nullable().optional(),
			pagibig: z.number().int().min(1).max(31).nullable().optional(),
			bir: z.number().int().min(1).max(31).nullable().optional()
		})
		.default({})
});
export type RemittanceSettings = z.infer<typeof settingsSchema>;

async function orgConfig(organizationId: string) {
	const org = await db
		.select({ config: organizations.config, tin: organizations.tin, name: organizations.name, legalName: organizations.legalName })
		.from(organizations)
		.where(eq(organizations.id, organizationId))
		.then((r) => r.at(0));
	if (!org) throw new RemittanceError('Organization not found.');
	return org;
}

export async function getRemittanceSettings(organizationId: string) {
	const org = await orgConfig(organizationId);
	const raw = (org.config as { remittance?: unknown } | null)?.remittance;
	return {
		...settingsSchema.parse(raw ?? {}),
		employer: { name: org.legalName ?? org.name, tin: org.tin }
	};
}

export async function saveRemittanceSettings(organizationId: string, input: RemittanceSettings) {
	const org = await orgConfig(organizationId);
	const remittance = settingsSchema.parse(input);
	await db
		.update(organizations)
		.set({ config: { ...(org.config as object), remittance }, updatedAt: new Date() })
		.where(eq(organizations.id, organizationId));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Lines of locked/released batches whose run is paid in `period`, and how many batches are still draft. */
export async function monthLines(organizationId: string, period: string) {
	const inMonth = and(eq(payrollRuns.organizationId, organizationId), sql`to_char(${payrollRuns.payDate}, 'YYYY-MM') = ${period}`);

	const batches = await db
		.select({ id: payrollBatches.id, status: payrollBatches.status, runId: payrollBatches.runId })
		.from(payrollBatches)
		.innerJoin(payrollRuns, eq(payrollRuns.id, payrollBatches.runId))
		.where(inMonth);
	const final = batches.filter((b) => b.status !== 'draft');
	const draftBatches = batches.length - final.length;
	const runIds = [...new Set(batches.map((b) => b.runId))];

	const lines = final.length
		? await db
				.select({
					employeeId: payrollRunLines.employeeId,
					employeeName: payrollRunLines.employeeName,
					employeeNo: payrollRunLines.employeeNo,
					establishmentId: payrollRunLines.establishmentId,
					govIds: payrollRunLines.govIds,
					deductions: payrollRunLines.deductions,
					employerContributions: payrollRunLines.employerContributions,
					detail: payrollRunLines.detail
				})
				.from(payrollRunLines)
				.where(inArray(payrollRunLines.batchId, final.map((b) => b.id)))
		: [];

	const scheduleLines: ScheduleLine[] = lines.map(({ detail, ...l }) => ({
		...l,
		coverage: (detail as { coverage?: ScheduleLine['coverage'] } | null)?.coverage
	}));
	return { lines: scheduleLines, draftBatches, runCount: runIds.length };
}

export async function getRemittance(organizationId: string, agency: Agency, period: string): Promise<Remittance | null> {
	return db
		.select()
		.from(remittances)
		.where(and(eq(remittances.organizationId, organizationId), eq(remittances.agency, agency), eq(remittances.period, period)))
		.then((r) => r.at(0) ?? null);
}

export async function getSchedule(organizationId: string, agency: Agency, period: string) {
	const [{ lines, draftBatches, runCount }, record, settings] = await Promise.all([
		monthLines(organizationId, period),
		getRemittance(organizationId, agency, period),
		getRemittanceSettings(organizationId)
	]);
	return {
		schedule: buildSchedule(agency, lines),
		record,
		draftBatches,
		runCount,
		dueDate: record?.dueDate ?? dueDateFor(period, settings.dueDay[agency]),
		settings
	};
}

/** The four agencies for a month: amount, people, status and due date. */
export async function getOverview(organizationId: string, period: string, today: string) {
	const [{ lines, draftBatches, runCount }, settings, records] = await Promise.all([
		monthLines(organizationId, period),
		getRemittanceSettings(organizationId),
		db
			.select()
			.from(remittances)
			.where(and(eq(remittances.organizationId, organizationId), eq(remittances.period, period)))
	]);
	const byAgency = new Map(records.map((r) => [r.agency, r]));
	return {
		draftBatches,
		runCount,
		agencies: AGENCIES.map((agency) => {
			const s = buildSchedule(agency, lines);
			const record = byAgency.get(agency) ?? null;
			const due = record?.dueDate ?? dueDateFor(period, settings.dueDay[agency]);
			const remitted = record?.status === 'remitted';
			return {
				agency,
				label: AGENCY_LABEL[agency],
				people: s.rows.length,
				amount: remitted ? (record!.amountCentavos ?? s.totals.total) : s.totals.total,
				status: (remitted ? 'remitted' : 'open') as 'remitted' | 'open',
				dueDate: due,
				overdue: !remitted && s.totals.total > 0 && due !== null && due < today,
				warnings: s.missingId.length
			};
		})
	};
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export const remitFormSchema = z.object({
	remittedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the date it was paid.'),
	referenceNo: z.string().trim().min(1, 'Enter the payment reference no.').max(80),
	note: z.string().trim().max(500).optional()
});

export async function markRemitted(
	organizationId: string,
	agency: Agency,
	period: string,
	input: z.infer<typeof remitFormSchema>,
	userId: string | null
) {
	const { schedule, draftBatches, record } = await getSchedule(organizationId, agency, period);
	if (record?.status === 'remitted') throw new RemittanceError('Already marked as remitted.');
	if (draftBatches > 0) {
		throw new RemittanceError(
			`${draftBatches} payroll batch${draftBatches === 1 ? ' is' : 'es are'} not locked yet for this month — the amount would be incomplete.`
		);
	}
	if (schedule.totals.total <= 0) throw new RemittanceError('There is nothing to remit for this agency and month.');

	const values = {
		status: 'remitted' as const,
		remittedOn: input.remittedOn,
		referenceNo: input.referenceNo,
		note: input.note || null,
		amountCentavos: schedule.totals.total,
		lineCount: schedule.rows.length,
		remittedByUserId: userId,
		updatedAt: new Date()
	};
	const [row] = await db
		.insert(remittances)
		.values({ organizationId, agency, period, ...values })
		.onConflictDoUpdate({ target: [remittances.organizationId, remittances.agency, remittances.period], set: values })
		.returning();
	return row!;
}

/** Undo — Main HR only; the caller audits it. Keeps the row so the due date survives. */
export async function reopenRemittance(organizationId: string, agency: Agency, period: string) {
	const [row] = await db
		.update(remittances)
		.set({
			status: 'open',
			remittedOn: null,
			referenceNo: null,
			amountCentavos: null,
			lineCount: null,
			remittedByUserId: null,
			updatedAt: new Date()
		})
		.where(
			and(
				eq(remittances.organizationId, organizationId),
				eq(remittances.agency, agency),
				eq(remittances.period, period),
				eq(remittances.status, 'remitted')
			)
		)
		.returning();
	if (!row) throw new RemittanceError('That remittance is not marked as remitted.');
	return row;
}

/** A batch whose month has a remitted agency can't be reopened — the filed figure must not drift. */
export async function remittedAgenciesForBatch(batchId: string): Promise<Agency[]> {
	const run = await db
		.select({ organizationId: payrollRuns.organizationId, payDate: payrollRuns.payDate })
		.from(payrollBatches)
		.innerJoin(payrollRuns, eq(payrollRuns.id, payrollBatches.runId))
		.where(eq(payrollBatches.id, batchId))
		.then((r) => r.at(0));
	if (!run) return [];
	const rows = await db
		.select({ agency: remittances.agency })
		.from(remittances)
		.where(
			and(
				eq(remittances.organizationId, run.organizationId),
				eq(remittances.period, run.payDate.slice(0, 7)),
				eq(remittances.status, 'remitted')
			)
		);
	return rows.map((r) => r.agency as Agency);
}

export function toCsv(schedule: Schedule): string {
	const peso = (c: number) => (c / 100).toFixed(2);
	const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
	const head = ['Employee no.', 'Name', 'ID number', 'Employee share', 'Employer share', 'EC', 'Total'];
	const body = schedule.rows.map((r) =>
		[r.employeeNo, r.name, r.idNumber ?? '', peso(r.employee), peso(r.employer), peso(r.ec), peso(r.total)].map(esc).join(',')
	);
	const t = schedule.totals;
	body.push(['', 'TOTAL', '', peso(t.employee), peso(t.employer), peso(t.ec), peso(t.total)].join(','));
	return [head.join(','), ...body].join('\r\n') + '\r\n';
}
