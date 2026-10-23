import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	DEFAULT_CONTRACT_TEMPLATES,
	MERGE_FIELDS,
	fingerprintOf,
	maskedName,
	splitSignatures,
	renderContract,
	unknownFields,
	validateTerm
} from './contracts';
import { cleanupTestEstablishments, createTestStaff, testOrgId } from './test-helpers';

describe('contract wording', () => {
	it('fills every field and leaves an unknown one visible instead of blanking it', () => {
		const out = renderContract('Hi {{employee_name}}, {{ position }} from {{start_date}} {{nope}}', {
			employee_name: 'Ana Cruz',
			position: 'Cook',
			start_date: 'January 1, 2027'
		});
		expect(out).toBe('Hi Ana Cruz, Cook from January 1, 2027 {{nope}}');
		expect(unknownFields('{{employee_name}} {{nope}} {{ also_bad }}').sort()).toEqual(['also_bad', 'nope']);
	});

	it('treats the output as plain text: markup in a name is not interpreted', () => {
		expect(renderContract('{{employee_name}}', { employee_name: '<script>x</script>' })).toBe('<script>x</script>');
	});

	it('every default template uses only known fields and mentions the type-specific term', () => {
		for (const [kind, text] of Object.entries(DEFAULT_CONTRACT_TEMPLATES)) {
			expect(unknownFields(text), kind).toEqual([]);
			expect(text, kind).toContain('{{employee_name}}');
			expect(text, kind).toContain('{{rate}}');
		}
		expect(DEFAULT_CONTRACT_TEMPLATES.probationary).toContain('{{probation_end}}');
		expect(DEFAULT_CONTRACT_TEMPLATES.probationary).toMatch(/six \(6\) months/);
		expect(DEFAULT_CONTRACT_TEMPLATES.fixed_term).toContain('{{end_date}}');
		expect(MERGE_FIELDS.length).toBeGreaterThan(8);
	});
});

describe('signature block', () => {
	it('lifts the names and roles out of the closing block so they can be laid out in columns', () => {
		const body = renderContract(DEFAULT_CONTRACT_TEMPLATES.regular, {
			employee_name: 'Carlo june Caimen', employer_name: 'mmhoteltandag', address: 'a', position: 'p', employment_type: 'Regular',
			start_date: 'January 1, 2026', end_date: 'x', probation_end: 'x', rate: 'r', establishment: 'e', establishment_address: 'ea', today: 't'
		});
		const s = splitSignatures(body)!;
		expect(s.blocks).toEqual([
			{ name: 'mmhoteltandag', role: 'Employer / authorized representative' },
			{ name: 'Carlo june Caimen', role: 'Employee' }
		]);
		expect(s.text).toContain('The parties have read and agree to this contract.');
		expect(s.text).not.toContain('______');
	});

	it('leaves wording without a closing block exactly as it is', () => {
		expect(splitSignatures('Just some text.\nNo signatures here.')).toBeNull();
	});
});

describe('contract authenticity', () => {
	it('the fingerprint is stable for the same wording and changes when one character does', () => {
		const a = fingerprintOf('The Employee shall be paid 25,000.');
		expect(a).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
		expect(fingerprintOf('The Employee shall be paid 25,000.')).toBe(a);
		expect(fingerprintOf('The Employee shall be paid 26,000.')).not.toBe(a);
	});

	it('masks a name to the first name and the initial of the last', () => {
		expect(maskedName('Carlo june', 'Caimen')).toBe('Carlo june C.');
		expect(maskedName(' Ana ', ' cruz ')).toBe('Ana C.');
	});
});

describe('contract terms', () => {
	it('a fixed-term, project, seasonal or casual contract must say when it ends', () => {
		for (const k of ['fixed_term', 'project', 'seasonal', 'casual'] as const) {
			expect(validateTerm(k, '2027-01-01', null), k).toMatch(/must say when it ends/);
			expect(validateTerm(k, '2027-01-01', '2027-06-30'), k).toBeNull();
		}
	});

	it('probation needs an end and cannot exceed six months', () => {
		expect(validateTerm('probationary', '2027-01-01', null)).toMatch(/probation ends/);
		expect(validateTerm('probationary', '2027-01-01', '2027-07-01')).toBeNull();
		expect(validateTerm('probationary', '2027-01-01', '2027-07-02')).toMatch(/six months/);
	});

	it('an end before the start is refused, and a regular contract needs no end', () => {
		expect(validateTerm('regular', '2027-02-01', '2027-01-01')).toMatch(/before the start/);
		expect(validateTerm('regular', '2027-02-01', null)).toBeNull();
	});
});

async function hasDb() {
	try {
		const { env } = await import('$env/dynamic/private');
		return Boolean(env.DATABASE_URL);
	} catch {
		return false;
	}
}
const live = await hasDb();

describe.skipIf(!live)('contracts (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const { employeeContracts, employees, establishments, organizations } = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { eq } = await import('drizzle-orm');
	const C = await import('./contracts');

	const tag = `contract-${Math.random().toString(36).slice(2, 10)}`;
	let org = '';
	let est = '';
	let ana = '';
	let originalConfig: unknown = {};

	beforeAll(async () => {
		org = await testOrgId();
		originalConfig = (await db.select({ c: organizations.config }).from(organizations).where(eq(organizations.id, org)))[0]!.c;
		const [e] = await db
			.insert(establishments)
			.values({ organizationId: org, kind: 'business', slug: tag, name: 'Contract test', orgRef: mintRef('org'), city: 'Cebu City' })
			.returning({ id: establishments.id });
		est = e!.id;
		ana = await createTestStaff(est, { employeeNo: 'CT1', firstName: 'Ana', hiredOn: '2027-01-01', position: 'Line Cook' });
		await db.update(employees).set({ address: '5 Lakeshore Dr', baseRateCentavos: 2_500_000, payBasis: 'monthly' }).where(eq(employees.id, ana));
	});
	afterAll(async () => {
		const { deleteContractDocument } = await import('$lib/server/uploads');
		for (const c of await db.select().from(employeeContracts).where(eq(employeeContracts.employeeId, ana))) {
			if (c.storedName) await deleteContractDocument(c.storedName);
		}
		await db.delete(employeeContracts).where(eq(employeeContracts.employeeId, ana));
		await cleanupTestEstablishments([est]);
		await db.update(organizations).set({ config: originalConfig as object }).where(eq(organizations.id, org));
	});

	it('issues a probationary contract with the position and pay frozen into the wording', async () => {
		const c = await C.createContract(org, { employeeId: ana, kind: 'probationary', startDate: '2027-01-01', endDate: '2027-06-30' }, null);
		expect(c.status).toBe('issued');
		expect(c.position).toBe('Line Cook');
		expect(c.baseRateCentavos).toBe(2_500_000);
		expect(c.body).toContain('Ana Test');
		expect(c.body).toContain('Line Cook');
		expect(c.body).toContain('₱25,000.00 per month');
		expect(c.body).toContain('June 30, 2027');
		expect(c.body).not.toMatch(/\{\{/);
		// A later raise does not rewrite what was issued.
		await db.update(employees).set({ baseRateCentavos: 3_000_000 }).where(eq(employees.id, ana));
		const again = await C.getContract(org, c.id);
		expect(again.body).toContain('₱25,000.00 per month');
	});

	it('refuses a fixed-term contract without an end date and a person who does not exist', async () => {
		await expect(C.createContract(org, { employeeId: ana, kind: 'fixed_term', startDate: '2027-01-01', endDate: '' }, null)).rejects.toThrow(/must say when it ends/);
		await expect(
			C.createContract(org, { employeeId: '00000000-0000-4000-8000-000000000000', kind: 'regular', startDate: '2027-01-01', endDate: '' }, null)
		).rejects.toThrow(/does not exist/);
	});

	it('a saved template is used for the next contract, and reset brings the default back', async () => {
		await C.saveContractTemplate(org, {
			kind: 'regular',
			text: 'CUSTOM regular contract for {{employee_name}} as {{position}} on {{start_date}}. Pay: {{rate}}.'
		});
		const c = await C.createContract(org, { employeeId: ana, kind: 'regular', startDate: '2027-07-01', endDate: '' }, null);
		expect(c.body.startsWith('CUSTOM regular contract for Ana Test as Line Cook')).toBe(true);
		await expect(C.saveContractTemplate(org, { kind: 'regular', text: 'Dear {{employee_name}} {{who_is_this}} and more text here to pass length' })).rejects.toThrow(/Unknown field/);
		await C.resetContractTemplate(org, 'regular');
		expect((await C.getContractTemplates(org)).regular).toBe(C.DEFAULT_CONTRACT_TEMPLATES.regular);
	});

	it('lists contracts, finds ones ending soon, and a newer contract replaces an older one', async () => {
		const list = await C.listContracts(org, ana);
		expect(list.length).toBeGreaterThanOrEqual(2);
		const due = await C.contractsDue(org, '2027-06-15', 30);
		const probation = due.find((d) => d.kind === 'probationary' && d.employeeId === ana);
		// The regular contract issued after it has no end date and is the newest, so the probation is replaced.
		expect(probation).toBeUndefined();

		// With only the probation as the live contract, it is due.
		const all = await C.listContracts(org, ana);
		for (const r of all.filter((x) => x.kind === 'regular')) await C.voidContract(org, r.id, 'test cleanup');
		const dueNow = await C.contractsDue(org, '2027-06-15', 30);
		const row = dueNow.find((d) => d.kind === 'probationary' && d.employeeId === ana)!;
		expect(row.daysLeft).toBe(15);
		expect(row.overdue).toBe(false);
		expect((await C.contractsDue(org, '2027-07-15', 30)).find((d) => d.employeeId === ana)!.overdue).toBe(true);
		expect((await C.contractsDue(org, '2027-01-01', 30)).find((d) => d.employeeId === ana)).toBeUndefined();
	});

	it('void needs a reason and cannot be repeated; a voided contract cannot be signed', async () => {
		const c = await C.createContract(org, { employeeId: ana, kind: 'project', startDate: '2027-02-01', endDate: '2027-03-01' }, null);
		await expect(C.voidContract(org, c.id, '')).rejects.toThrow(/Say why/);
		await C.voidContract(org, c.id, 'Wrong project dates');
		await expect(C.voidContract(org, c.id, 'again')).rejects.toThrow(/already void/);
		const file = new File([new Uint8Array([37, 80, 68, 70])], 'signed.pdf', { type: 'application/pdf' });
		await expect(C.attachSigned(org, c.id, file, null)).rejects.toThrow(/voided/);
	});

	it('every contract gets its own verify code, and the public lookup shows only what is safe', async () => {
		const a = await C.createContract(org, { employeeId: ana, kind: 'regular', startDate: '2028-01-01', endDate: '' }, null);
		const b = await C.createContract(org, { employeeId: ana, kind: 'regular', startDate: '2028-02-01', endDate: '' }, null);
		expect(a.verifyCode).toMatch(/^[A-Za-z0-9_-]{16,}$/);
		expect(b.verifyCode).not.toBe(a.verifyCode);
		const pub = (await C.publicContractByCode(a.verifyCode!))!;
		expect(pub.employee).toBe('Ana T.');
		expect(pub.status).toBe('issued');
		expect(pub.fingerprint).toBe(C.fingerprintOf(a.body));
		const json = JSON.stringify(pub);
		expect(json).not.toMatch(/25,000|baseRate|address|Lakeshore/i);
		await C.voidContract(org, a.id, 'Wrong date');
		expect((await C.publicContractByCode(a.verifyCode!))!.status).toBe('void');
	});

	it('rejects unknown and malformed codes, and gives an older contract a code on first use', async () => {
		expect(await C.publicContractByCode('A'.repeat(22))).toBeNull();
		expect(await C.publicContractByCode('short')).toBeNull();
		expect(await C.publicContractByCode("' OR 1=1 --")).toBeNull();
		const c = await C.createContract(org, { employeeId: ana, kind: 'regular', startDate: '2028-03-01', endDate: '' }, null);
		await db.update(employeeContracts).set({ verifyCode: null }).where(eq(employeeContracts.id, c.id));
		const code = await C.ensureVerifyCode(org, c.id);
		expect(code.length).toBeGreaterThanOrEqual(16);
		expect(await C.ensureVerifyCode(org, c.id)).toBe(code);
		expect((await C.publicContractByCode(code))!.position).toBe('Line Cook');
	});

	it('signing stores the file and marks the contract signed', async () => {
		const c = await C.createContract(org, { employeeId: ana, kind: 'seasonal', startDate: '2027-11-01', endDate: '2027-12-31' }, null);
		const file = new File([new Uint8Array([37, 80, 68, 70, 45])], 'signed.pdf', { type: 'application/pdf' });
		await C.attachSigned(org, c.id, file, '2027-10-30');
		const got = await C.getContract(org, c.id);
		expect(got.status).toBe('signed');
		expect(got.signedOn).toBe('2027-10-30');
		expect(got.storedName).toMatch(/\.pdf$/);
		await expect(C.attachSigned(org, c.id, new File([new Uint8Array([1])], 'x.exe', { type: 'application/x-msdownload' }), null)).rejects.toThrow(/PDF, JPEG/);
	});
});
