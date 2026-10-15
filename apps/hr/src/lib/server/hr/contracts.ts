import { createHash, randomBytes } from 'node:crypto';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import {
	employeeAssignments,
	employeeContracts,
	employees,
	establishments,
	organizations
} from '$lib/server/db/schema/index';
import { businessDateFor } from '$lib/server/time';
import { EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABEL } from '$lib/leave';
import { deleteContractDocument, saveContractDocument } from '$lib/server/uploads';

export class ContractError extends Error {}

const TZ = 'Asia/Manila';
const newVerifyCode = () => randomBytes(16).toString('base64url');

/** A short fingerprint of the wording, printed on the contract and shown on the verify page so a copy can be compared. */
export function fingerprintOf(body: string): string {
	const hex = createHash('sha256').update(body).digest('hex').toUpperCase().slice(0, 16);
	return hex.match(/.{4}/g)!.join('-');
}

/**
 * Separates the signature block at the end of a contract (a line of underscores, then names, then roles, as the
 * templates write it) so a page can lay it out as real columns. Null when the text has no such block, in which case
 * the whole text is shown as written.
 */
export function splitSignatures(body: string): { text: string; blocks: Array<{ name: string; role: string }> } | null {
	const lines = body.replace(/\s+$/, '').split('\n');
	let at = -1;
	for (let i = lines.length - 1; i >= 0 && i >= lines.length - 6; i--) {
		if (/^\s*_{8,}/.test(lines[i]!)) {
			at = i;
			break;
		}
	}
	if (at < 0) return null;
	const names = (lines[at + 1] ?? '').trim().split(/\s{2,}/).filter(Boolean);
	const roles = (lines[at + 2] ?? '').trim().split(/\s{2,}/).filter(Boolean);
	if (names.length === 0 || names.length > 3 || roles.length !== names.length) return null;
	return {
		text: lines.slice(0, at).join('\n').replace(/\s+$/, ''),
		blocks: names.map((name, i) => ({ name, role: roles[i]! }))
	};
}

/** "Carlo june C." — enough to recognise, not enough to publish a person's full name. */
export function maskedName(first: string, last: string): string {
	return `${first.trim()} ${last.trim().charAt(0).toUpperCase()}.`;
}
export type ContractKind = (typeof EMPLOYMENT_TYPES)[number];

// ---------------------------------------------------------------------------
// Wording: merge fields, defaults, rendering
// ---------------------------------------------------------------------------

/** The `{{fields}}` a template may use, with what each one fills in. */
export const MERGE_FIELDS: Array<[string, string]> = [
	['employee_name', 'First and last name'],
	['address', 'Home address on the employee record'],
	['position', 'Position'],
	['employment_type', 'Employment type, for example Probationary'],
	['start_date', 'First day of the contract'],
	['end_date', 'End of the term, or "no fixed end date"'],
	['probation_end', 'End of probation (probationary contracts)'],
	['rate', 'Pay, for example ₱25,000.00 per month'],
	['employer_name', 'Company name'],
	['establishment', 'Establishment the person works at'],
	['establishment_address', 'Establishment address'],
	['today', 'The date the contract is issued']
];
const FIELD_NAMES = new Set(MERGE_FIELDS.map(([k]) => k));

const HEAD = `EMPLOYMENT CONTRACT

This contract is made on {{today}} between {{employer_name}}, operating {{establishment}} at {{establishment_address}} (the "Employer"), and {{employee_name}}, of {{address}} (the "Employee").
`;

const COMMON = `
POSITION AND DUTIES
The Employee is engaged as {{position}} and shall perform the duties of that position and any related duties reasonably assigned by the Employer, observing the Employer's rules, policies and lawful instructions.

COMPENSATION
The Employee shall be paid {{rate}}, subject to the deductions required by law (withholding tax and the employee share of SSS, PhilHealth and Pag-IBIG contributions), payable on the Employer's regular payroll dates.

HOURS OF WORK
Hours of work, rest days and breaks follow the schedule set by the Employer in accordance with law.

CONFIDENTIALITY AND COMPANY PROPERTY
The Employee shall keep the Employer's confidential information confidential and shall return all company property on separation.

SEPARATION
Either party may end this employment in the manner and for the causes allowed by law. Final pay shall be released according to law and company policy after clearance.

GOVERNING LAW
This contract is governed by the laws of the Republic of the Philippines.

The parties have read and agree to this contract.


______________________________          ______________________________
{{employer_name}}                        {{employee_name}}
Employer / authorized representative     Employee
`;

const term = (clause: string) => `${HEAD}\n${clause}\n${COMMON}`;

export const DEFAULT_CONTRACT_TEMPLATES: Record<ContractKind, string> = {
	regular: term(`TERM
The Employee is engaged as a regular employee beginning {{start_date}}, with no fixed end date.`),
	probationary: term(`PROBATIONARY PERIOD
The Employee is engaged on probation from {{start_date}} to {{probation_end}}, which shall not exceed six (6) months. The Employee shall become a regular employee upon satisfactorily meeting the following standards, which have been made known to the Employee at the time of engagement:
  1. Satisfactory quality and quantity of work for the position;
  2. Good attendance and punctuality;
  3. Compliance with company rules, policies and instructions;
  4. Honesty, teamwork and proper conduct toward guests, co-workers and management.
Failing these standards, the Employer may end the probation in accordance with law before or at the end of the period.`),
	fixed_term: term(`TERM
The Employee is engaged for a fixed term from {{start_date}} to {{end_date}}, and the employment ends upon the expiry of that term unless renewed in writing.`),
	project: term(`PROJECT
The Employee is engaged for a specific project beginning {{start_date}} and ending {{end_date}} or upon completion of the project, whichever comes first, as made known to the Employee at the time of engagement.`),
	seasonal: term(`SEASON
The Employee is engaged for the season beginning {{start_date}} and ending {{end_date}}. The Employee shall be called again when the season returns, subject to the Employer's needs.`),
	casual: term(`TERM
The Employee is engaged as a casual employee beginning {{start_date}}, for work that is not usually necessary or desirable to the Employer's business, and the engagement ends on {{end_date}}.`),
	part_time: term(`TERM
The Employee is engaged on a part-time basis beginning {{start_date}} and ending {{end_date}}. Hours of work are as scheduled by the Employer.`)
};

/** The fields a template uses that this app does not know — shown to the editor, never silently blanked. */
export function unknownFields(text: string): string[] {
	const found = new Set<string>();
	for (const m of text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)) if (!FIELD_NAMES.has(m[1]!)) found.add(m[1]!);
	return [...found];
}

/** Fills the `{{fields}}`. Plain text in, plain text out (the page renders it pre-wrapped, never as HTML). */
export function renderContract(template: string, values: Record<string, string>): string {
	return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, key: string) => (key in values ? values[key]! : whole));
}

const peso = (c: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(c / 100);
const longDate = (iso: string) =>
	new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const rateText = (payBasis: string, centavos: number) =>
	`${peso(centavos)} per ${payBasis === 'monthly' ? 'month' : payBasis === 'daily' ? 'day' : 'hour'}`;

// ---------------------------------------------------------------------------
// Template storage (organizations.config.contractTemplates)
// ---------------------------------------------------------------------------

export async function getContractTemplates(organizationId: string): Promise<Record<ContractKind, string>> {
	const row = await db.select({ config: organizations.config }).from(organizations).where(eq(organizations.id, organizationId)).then((r) => r.at(0));
	const saved = ((row?.config ?? {}) as { contractTemplates?: Partial<Record<ContractKind, string>> }).contractTemplates ?? {};
	const out = { ...DEFAULT_CONTRACT_TEMPLATES };
	for (const k of EMPLOYMENT_TYPES) if (typeof saved[k] === 'string' && saved[k]!.trim()) out[k] = saved[k]!;
	return out;
}

const templateSchema = z.object({
	kind: z.enum(EMPLOYMENT_TYPES),
	text: z.string().trim().min(40, 'The contract wording is too short.').max(20_000)
});

export async function saveContractTemplate(organizationId: string, input: unknown) {
	const parsed = templateSchema.safeParse(input);
	if (!parsed.success) throw new ContractError(parsed.error.issues[0]?.message ?? 'Check the wording.');
	const bad = unknownFields(parsed.data.text);
	if (bad.length) throw new ContractError(`Unknown field${bad.length === 1 ? '' : 's'}: ${bad.map((b) => `{{${b}}}`).join(', ')}.`);
	await writeTemplates(organizationId, (cur) => ({ ...cur, [parsed.data.kind]: parsed.data.text }));
	return parsed.data;
}

export async function resetContractTemplate(organizationId: string, kind: ContractKind) {
	await writeTemplates(organizationId, (cur) => {
		const next = { ...cur };
		delete next[kind];
		return next;
	});
}

async function writeTemplates(organizationId: string, fn: (cur: Record<string, string>) => Record<string, string>) {
	const row = await db.select({ config: organizations.config }).from(organizations).where(eq(organizations.id, organizationId)).then((r) => r.at(0));
	if (!row) throw new ContractError('Organization not found.');
	const config = (row.config ?? {}) as { contractTemplates?: Record<string, string> };
	await db
		.update(organizations)
		.set({ config: { ...config, contractTemplates: fn(config.contractTemplates ?? {}) }, updatedAt: new Date() })
		.where(eq(organizations.id, organizationId));
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.');
export const contractFormSchema = z.object({
	employeeId: z.string().uuid('Pick the employee.'),
	kind: z.enum(EMPLOYMENT_TYPES, { message: 'Pick the employment type.' }),
	startDate: isoDate,
	endDate: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), isoDate.nullable())
});

const addMonths = (iso: string, n: number) => {
	const d = new Date(`${iso}T00:00:00Z`);
	d.setUTCMonth(d.getUTCMonth() + n);
	return d.toISOString().slice(0, 10);
};

/** Terms the law and sense require, as one message each; empty when the dates are acceptable. */
export function validateTerm(kind: ContractKind, startDate: string, endDate: string | null): string | null {
	if (endDate && endDate < startDate) return 'The end date is before the start.';
	if ((kind === 'fixed_term' || kind === 'project' || kind === 'seasonal' || kind === 'casual') && !endDate) {
		return `A ${EMPLOYMENT_TYPE_LABEL[kind].toLowerCase()} contract must say when it ends.`;
	}
	if (kind === 'probationary') {
		if (!endDate) return 'A probationary contract must say when probation ends.';
		if (endDate > addMonths(startDate, 6)) return 'Probation cannot be longer than six months.';
	}
	return null;
}

export async function createContract(organizationId: string, input: unknown, userId: string | null) {
	const parsed = contractFormSchema.safeParse(input);
	if (!parsed.success) throw new ContractError(parsed.error.issues[0]?.message ?? 'Check the form.');
	const { employeeId, kind, startDate, endDate } = parsed.data;
	const problem = validateTerm(kind, startDate, endDate);
	if (problem) throw new ContractError(problem);

	const emp = await db
		.select()
		.from(employees)
		.where(and(eq(employees.id, employeeId), eq(employees.organizationId, organizationId), isNull(employees.deletedAt)))
		.then((r) => r.at(0));
	if (!emp) throw new ContractError('That person does not exist.');
	const assignment = await db
		.select({ position: employeeAssignments.position, est: establishments })
		.from(employeeAssignments)
		.innerJoin(establishments, eq(establishments.id, employeeAssignments.establishmentId))
		.where(eq(employeeAssignments.employeeId, employeeId))
		.orderBy(desc(employeeAssignments.isPrimary), desc(employeeAssignments.startDate))
		.limit(1)
		.then((r) => r.at(0));
	if (!assignment) throw new ContractError('Assign the person to an establishment first.');
	const org = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, organizationId)).then((r) => r.at(0));
	const today = businessDateFor(TZ);

	const templates = await getContractTemplates(organizationId);
	const body = renderContract(templates[kind], {
		employee_name: `${emp.firstName} ${emp.lastName}`,
		address: emp.address ?? '(address not on file)',
		position: assignment.position,
		employment_type: EMPLOYMENT_TYPE_LABEL[kind],
		start_date: longDate(startDate),
		end_date: endDate ? longDate(endDate) : 'no fixed end date',
		probation_end: endDate ? longDate(endDate) : '',
		rate: rateText(emp.payBasis, emp.baseRateCentavos),
		employer_name: assignment.est.legalName || org?.name || 'the Company',
		establishment: assignment.est.name,
		establishment_address: [assignment.est.addressLine, assignment.est.city].filter(Boolean).join(', ') || '(address not on file)',
		today: longDate(today)
	});

	const [row] = await db
		.insert(employeeContracts)
		.values({
			organizationId,
			employeeId,
			establishmentId: assignment.est.id,
			kind,
			position: assignment.position,
			payBasis: emp.payBasis,
			baseRateCentavos: emp.baseRateCentavos,
			startDate,
			endDate,
			body,
			status: 'issued',
			issuedOn: today,
			verifyCode: newVerifyCode(),
			createdByUserId: userId
		})
		.returning();
	return row!;
}

/** The contract's verify code, creating one for a contract issued before codes existed. */
export async function ensureVerifyCode(organizationId: string, id: string): Promise<string> {
	const c = await getContract(organizationId, id);
	if (c.verifyCode) return c.verifyCode;
	const code = newVerifyCode();
	await db.update(employeeContracts).set({ verifyCode: code }).where(eq(employeeContracts.id, id));
	return code;
}

/**
 * What the public verify page may say about a contract, found by its code alone: that it exists, who it was
 * issued by, to whom (masked), for what, and whether it is still in force. Never pay or address.
 */
export async function publicContractByCode(code: string) {
	if (!/^[A-Za-z0-9_-]{16,64}$/.test(code)) return null;
	const row = await db
		.select({ c: employeeContracts, first: employees.firstName, last: employees.lastName, org: organizations.name, est: establishments.legalName, estName: establishments.name })
		.from(employeeContracts)
		.innerJoin(employees, eq(employees.id, employeeContracts.employeeId))
		.innerJoin(organizations, eq(organizations.id, employeeContracts.organizationId))
		.leftJoin(establishments, eq(establishments.id, employeeContracts.establishmentId))
		.where(eq(employeeContracts.verifyCode, code))
		.then((r) => r.at(0));
	if (!row) return null;
	return {
		issuedBy: row.est || row.estName || row.org,
		employee: maskedName(row.first, row.last),
		kind: row.c.kind,
		position: row.c.position,
		startDate: row.c.startDate,
		endDate: row.c.endDate,
		issuedOn: row.c.issuedOn,
		signedOn: row.c.signedOn,
		status: row.c.status as 'issued' | 'signed' | 'void',
		fingerprint: fingerprintOf(row.c.body)
	};
}

export interface ContractRow {
	id: string;
	employeeId: string;
	employeeName: string;
	employeeNo: string;
	establishment: string | null;
	kind: string;
	position: string;
	startDate: string;
	endDate: string | null;
	status: 'issued' | 'signed' | 'void';
	issuedOn: string;
	signedOn: string | null;
	hasFile: boolean;
	voidReason: string | null;
}

export async function listContracts(organizationId: string, employeeId?: string): Promise<ContractRow[]> {
	const rows = await db
		.select({ c: employeeContracts, last: employees.lastName, first: employees.firstName, no: employees.employeeNo, est: establishments.name })
		.from(employeeContracts)
		.innerJoin(employees, eq(employees.id, employeeContracts.employeeId))
		.leftJoin(establishments, eq(establishments.id, employeeContracts.establishmentId))
		.where(and(eq(employeeContracts.organizationId, organizationId), employeeId ? eq(employeeContracts.employeeId, employeeId) : undefined))
		.orderBy(desc(employeeContracts.issuedOn), asc(employees.lastName));
	return rows.map((r) => ({
		id: r.c.id,
		employeeId: r.c.employeeId,
		employeeName: `${r.last}, ${r.first}`,
		employeeNo: r.no,
		establishment: r.est,
		kind: r.c.kind,
		position: r.c.position,
		startDate: r.c.startDate,
		endDate: r.c.endDate,
		status: r.c.status as ContractRow['status'],
		issuedOn: r.c.issuedOn,
		signedOn: r.c.signedOn,
		hasFile: !!r.c.storedName,
		voidReason: r.c.voidReason
	}));
}

export async function getContract(organizationId: string, id: string) {
	const row = await db
		.select({ c: employeeContracts, last: employees.lastName, first: employees.firstName, no: employees.employeeNo })
		.from(employeeContracts)
		.innerJoin(employees, eq(employees.id, employeeContracts.employeeId))
		.where(and(eq(employeeContracts.id, id), eq(employeeContracts.organizationId, organizationId)))
		.then((r) => r.at(0));
	if (!row) throw new ContractError('That contract does not exist.');
	return { ...row.c, employeeName: `${row.last}, ${row.first}`, employeeNo: row.no };
}

/** Attaches the signed copy and marks the contract signed. A second upload replaces the first file. */
export async function attachSigned(organizationId: string, id: string, file: File, signedOn: string | null) {
	const c = await getContract(organizationId, id);
	if (c.status === 'void') throw new ContractError('A voided contract cannot be signed. Issue a new one.');
	const saved = await saveContractDocument(file);
	if (c.storedName) await deleteContractDocument(c.storedName);
	await db
		.update(employeeContracts)
		.set({
			status: 'signed',
			signedOn: signedOn ?? businessDateFor(TZ),
			storedName: saved.storedName,
			originalName: file.name.slice(0, 200) || 'contract',
			contentType: saved.contentType,
			sizeBytes: saved.sizeBytes,
			updatedAt: new Date()
		})
		.where(eq(employeeContracts.id, id));
}

/** Voids a contract (a signed one too: issuing a corrected one is the way to change terms). */
export async function voidContract(organizationId: string, id: string, reason: string) {
	const c = await getContract(organizationId, id);
	if (c.status === 'void') throw new ContractError('That contract is already void.');
	if (reason.trim().length < 3) throw new ContractError('Say why it is being voided.');
	await db
		.update(employeeContracts)
		.set({ status: 'void', voidReason: reason.trim().slice(0, 300), updatedAt: new Date() })
		.where(eq(employeeContracts.id, id));
}

/** Contracts and probations that end within `days` of `today` (or already ended and not replaced). */
export async function contractsDue(organizationId: string, today: string, days: number) {
	const horizon = new Date(`${today}T00:00:00Z`);
	horizon.setUTCDate(horizon.getUTCDate() + days);
	const until = horizon.toISOString().slice(0, 10);
	const rows = await listContracts(organizationId);
	const open = rows.filter((r) => r.status !== 'void' && r.endDate);
	// A person's newest live contract decides: a later one that starts after this end replaces it.
	const latest = new Map<string, ContractRow>();
	for (const r of rows.filter((x) => x.status !== 'void')) {
		const cur = latest.get(r.employeeId);
		if (!cur || (r.endDate ?? '9999-12-31') > (cur.endDate ?? '9999-12-31')) latest.set(r.employeeId, r);
	}
	return open
		.filter((r) => latest.get(r.employeeId)?.id === r.id && r.endDate! <= until)
		.map((r) => ({ ...r, overdue: r.endDate! < today, daysLeft: Math.round((Date.parse(r.endDate!) - Date.parse(today)) / 86_400_000) }))
		.sort((a, b) => a.endDate!.localeCompare(b.endDate!));
}

