import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { agencyOfRemit, listLoanTypes } from './loans';
import {
	organizations,
	payrollBatches,
	payrollLoanDeductions,
	payrollRunLines,
	payrollRuns,
	remittances,
	type Remittance
} from '$lib/server/db/schema/index';

export class RemittanceError extends Error {}

/** The fixed schedules. `sss_loan` / `pagibig_loan` are the government loan collections, paid apart from contributions. */
export const AGENCIES = ['sss', 'philhealth', 'pagibig', 'bir', 'sss_loan', 'pagibig_loan'] as const;
export type BaseAgency = (typeof AGENCIES)[number];
/**
 * A schedule key: a fixed agency, `loan:<loan type key>` (a bank, coop or other lender paid from its own
 * schedule), or `kept:<loan type key>` (a company-side loan — deducted, remitted to no one, listed for visibility).
 */
export type Agency = BaseAgency | `loan:${string}` | `kept:${string}`;
export const AGENCY_LABEL: Record<BaseAgency, string> = {
	sss: 'SSS',
	philhealth: 'PhilHealth',
	pagibig: 'Pag-IBIG',
	bir: 'BIR (withholding tax)',
	sss_loan: 'SSS loans',
	pagibig_loan: 'Pag-IBIG loans'
};
export const isLoanAgency = (a: Agency): boolean =>
	a === 'sss_loan' || a === 'pagibig_loan' || a.startsWith('loan:') || a.startsWith('kept:');
/** A schedule that can be filed and marked remitted — everything but a company-side loan. */
export const isRemittable = (a: Agency): boolean => !a.startsWith('kept:');
/** The label for a schedule; a lender's is its loan type's name (`names`: loan type key → name). */
export function agencyLabel(agency: Agency, names: ReadonlyMap<string, string> = new Map()): string {
	if (agency in AGENCY_LABEL) return AGENCY_LABEL[agency as BaseAgency];
	const key = agency.slice(agency.indexOf(':') + 1);
	return names.get(key) ?? key;
}
/** Which key of a person's government IDs each schedule is filed under (a lender has none). */
const ID_KEY: Record<BaseAgency, 'sss' | 'philhealth' | 'pagibig' | 'tin'> = {
	sss: 'sss',
	philhealth: 'philhealth',
	pagibig: 'pagibig',
	bir: 'tin',
	sss_loan: 'sss',
	pagibig_loan: 'pagibig'
};
const idKeyOf = (agency: Agency) => (agency in ID_KEY ? ID_KEY[agency as BaseAgency] : null);

/** The employer number an agency's schedule is filed under (loans use the contribution number). */
export function employerNoFor(
	agency: Agency,
	settings: { employerIds: { sss?: string; philhealth?: string; pagibig?: string }; employer: { tin: string | null } }
): string | null | undefined {
	if (agency === 'bir') return settings.employer.tin;
	if (agency === 'sss_loan') return settings.employerIds.sss;
	if (agency === 'pagibig_loan') return settings.employerIds.pagibig;
	if (!(agency in ID_KEY)) return null;
	return settings.employerIds[agency as 'sss' | 'philhealth' | 'pagibig'];
}

export const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Pick a month.');
/** A schedule that can be opened, exported and filed: a fixed agency or a lender (never a company-side loan). */
export const agencySchema = z
	.string()
	.refine((a) => (AGENCIES as readonly string[]).includes(a) || /^loan:[a-z0-9_]+$/.test(a), 'Unknown remittance.')
	.transform((a) => a as Agency);

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
	/** What each loan took on this payslip, with the loan's kind and reference at that time. */
	loans?: Array<{ kind: string; agency: string | null; referenceNo: string | null; deducted: number }>;
	/** Tax the year-end settlement paid back to the employee on this payslip, which comes off what is remitted. */
	taxReturned?: number;
	/** Snapshot taken when the payslip was generated. */
	coverage?: { sss?: boolean; philhealth?: boolean; pagibig?: boolean; withholdingExempt?: boolean; note?: string | null };
}

export interface ScheduleRow {
	employeeId: string;
	name: string;
	employeeNo: string;
	idNumber: string | null;
	/** Loan reference numbers, for the loan schedules. */
	reference: string | null;
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
	/** BIR only: tax paid back to employees at year-end, already netted off the figures. */
	taxReturned: number;
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
			// Tax returned to the employee at year-end is paid out of what was withheld, so it is not remitted.
			return { employee: num(l.deductions, 'withholding_tax') - (l.taxReturned ?? 0), employer: 0, ec: 0 };
		default: {
			// A loan schedule: a lender's own, or a company-side loan (no agency on the snapshot, matched by type).
			const kept = agency.startsWith('kept:') ? agency.slice(5) : null;
			const mine = (l.loans ?? []).filter((x) => (kept ? x.agency === null && x.kind === kept : x.agency === agency));
			return { employee: mine.reduce((a, x) => a + x.deducted, 0), employer: 0, ec: 0 };
		}
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
	let taxReturned = 0;

	for (const l of lines) {
		if (agency === 'bir') taxReturned += l.taxReturned ?? 0;
		const covered =
			agency === 'bir'
				? l.coverage?.withholdingExempt !== true
				: isLoanAgency(agency)
					? true
					: l.coverage?.[agency as 'sss' | 'philhealth' | 'pagibig'] !== false;
		if (!covered) notCovered.set(l.employeeId, { name: l.employeeName, note: l.coverage?.note ?? null });

		const s = shares(agency, l);
		if (s.employee + s.employer + s.ec === 0) continue;
		const row =
			people.get(l.employeeId) ??
			({
				employeeId: l.employeeId,
				name: l.employeeName,
				employeeNo: l.employeeNo,
				idNumber: (() => {
					const k = idKeyOf(agency);
					return k ? str(l.govIds, k) : null;
				})(),
				reference: null,
				employee: 0,
				employer: 0,
				ec: 0,
				total: 0
			} satisfies ScheduleRow);
		if (isLoanAgency(agency)) {
			const kept = agency.startsWith('kept:') ? agency.slice(5) : null;
			const refs = (l.loans ?? [])
				.filter((x) => (kept ? x.agency === null && x.kind === kept : x.agency === agency) && x.deducted > 0 && x.referenceNo)
				.map((x) => x.referenceNo!);
			const all = new Set([...(row.reference ? row.reference.split(', ') : []), ...refs]);
			row.reference = all.size ? [...all].join(', ') : null;
		}
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
		missingId: idKeyOf(agency) ? rows.filter((r) => !r.idNumber).map((r) => r.name) : [],
		taxReturned,
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
bir: z.number().int().min(1).max(31).nullable().optional(),
			sss_loan: z.number().int().min(1).max(31).nullable().optional(),
			pagibig_loan: z.number().int().min(1).max(31).nullable().optional(),
			/** Lender loan types' deadlines, by loan type key. */
			loans: z.record(z.string(), z.number().int().min(1).max(31).nullable()).optional()
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
						lineId: payrollRunLines.id,
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

	const loanRows = lines.length
		? await db
				.select({
					lineId: payrollLoanDeductions.lineId,
					kind: payrollLoanDeductions.kind,
					agency: payrollLoanDeductions.agency,
					referenceNo: payrollLoanDeductions.referenceNo,
					deducted: payrollLoanDeductions.deductedCentavos
				})
				.from(payrollLoanDeductions)
				.where(inArray(payrollLoanDeductions.lineId, lines.map((l) => l.lineId)))
		: [];
	const loansOf = new Map<string, NonNullable<ScheduleLine['loans']>>();
	for (const r of loanRows) {
		const list = loansOf.get(r.lineId) ?? [];
		list.push({ kind: r.kind, agency: r.agency, referenceNo: r.referenceNo, deducted: r.deducted });
		loansOf.set(r.lineId, list);
	}
	const scheduleLines: ScheduleLine[] = lines.map(({ detail, lineId, ...l }) => ({
		...l,
		loans: loansOf.get(lineId),
		coverage: (detail as { coverage?: ScheduleLine['coverage'] } | null)?.coverage,
		taxReturned: Math.max(0, -((detail as { annualTaxAdjustmentCentavos?: number } | null)?.annualTaxAdjustmentCentavos ?? 0))
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
		dueDate: record?.dueDate ?? dueDateFor(period, dueDayOf(settings, agency)),
		settings
	};
}

export type OverviewKind = 'agency' | 'lender' | 'kept';
export interface OverviewItem {
	agency: Agency;
	kind: OverviewKind;
	label: string;
	people: number;
	amount: number;
	/** 'kept' = a company-side loan: deducted from pay, remitted to no one. */
	status: 'open' | 'remitted' | 'kept';
	dueDate: string | null;
	overdue: boolean;
	warnings: number;
	/** Who is in it, for the list on the overview — the full schedule is one click away. */
	lines: Array<{ employeeId: string; name: string; employeeNo: string; reference: string | null; amount: number }>;
}

/** A deadline is "day N of the next month", per agency or per lender loan type. */
export function dueDayOf(settings: Pick<RemittanceSettings, 'dueDay'>, agency: Agency): number | null | undefined {
	if (agency.startsWith('loan:')) return settings.dueDay.loans?.[agency.slice(5)];
	if (agency.startsWith('kept:')) return null;
	return settings.dueDay[agency as BaseAgency];
}

/**
 * Everything the company may owe for a month, always listed — a zero is information too. Contributions first,
 * then every loan type: SSS and Pag-IBIG loans (one payment each), one schedule per bank/coop/lender loan type,
 * and company-side loans shown as "no remittance".
 */
export async function getOverview(organizationId: string, period: string, today: string) {
	const [{ lines, draftBatches, runCount }, settings, records, types] = await Promise.all([
		monthLines(organizationId, period),
		getRemittanceSettings(organizationId),
		db
			.select()
			.from(remittances)
			.where(and(eq(remittances.organizationId, organizationId), eq(remittances.period, period))),
		listLoanTypes(organizationId)
	]);
	const byAgency = new Map(records.map((r) => [r.agency, r]));
	const names = new Map(types.map((t) => [t.key, t.name]));

	const item = (agency: Agency, kind: OverviewKind): OverviewItem => {
		const s = buildSchedule(agency, lines);
		const record = byAgency.get(agency) ?? null;
		const due = kind === 'kept' ? null : (record?.dueDate ?? dueDateFor(period, dueDayOf(settings, agency)));
		const remitted = record?.status === 'remitted';
		return {
			agency,
			kind,
			label: agencyLabel(agency, names),
			people: s.rows.length,
			amount: remitted ? (record!.amountCentavos ?? s.totals.total) : s.totals.total,
			status: kind === 'kept' ? 'kept' : remitted ? 'remitted' : 'open',
			dueDate: due,
			overdue: kind !== 'kept' && !remitted && s.totals.total > 0 && due !== null && due < today,
			warnings: s.missingId.length,
			lines: s.rows.map((r) => ({
				employeeId: r.employeeId,
				name: r.name,
				employeeNo: r.employeeNo,
				reference: r.reference,
				amount: r.total
			}))
		};
	};

	const contributions = (['sss', 'philhealth', 'pagibig', 'bir'] as const).map((a) => item(a, 'agency'));
	const loans: OverviewItem[] = [item('sss_loan', 'agency'), item('pagibig_loan', 'agency')];
	for (const t of types) {
		// A type that is switched off still shows if it took money this month or was filed.
		const kind = agencyOfRemit(t.remitTo, t.key)?.startsWith('loan:') ? 'lender' : t.remitTo === 'none' ? 'kept' : null;
		if (!kind) continue;
		const agency = (kind === 'lender' ? `loan:${t.key}` : `kept:${t.key}`) as Agency;
		const row = item(agency, kind);
		if (t.active || row.people > 0 || byAgency.has(agency)) loans.push(row);
	}
	// What can actually be filed — the callers that watch deadlines and amounts due read this, not the whole list.
	const agencies = [...contributions, ...loans.filter((l) => l.kind !== 'kept')];
	return { draftBatches, runCount, contributions, loans, agencies };
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
	if (isLoanAgency(schedule.agency)) {
		const loanRows = schedule.rows.map((r) =>
			[r.employeeNo, r.name, r.idNumber ?? '', r.reference ?? '', peso(r.total)].map(esc).join(',')
		);
		loanRows.push(['', 'TOTAL', '', '', peso(schedule.totals.total)].join(','));
		return [['Employee no.', 'Name', 'ID number', 'Loan reference', 'Amount deducted'].join(','), ...loanRows].join('\r\n') + '\r\n';
	}
	const head = ['Employee no.', 'Name', 'ID number', 'Employee share', 'Employer share', 'EC', 'Total'];
	const body = schedule.rows.map((r) =>
		[r.employeeNo, r.name, r.idNumber ?? '', peso(r.employee), peso(r.employer), peso(r.ec), peso(r.total)].map(esc).join(',')
	);
	const t = schedule.totals;
	body.push(['', 'TOTAL', '', peso(t.employee), peso(t.employer), peso(t.ec), peso(t.total)].join(','));
	return [head.join(','), ...body].join('\r\n') + '\r\n';
}
