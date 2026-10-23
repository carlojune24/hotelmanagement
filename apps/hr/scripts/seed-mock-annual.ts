import 'dotenv/config';
import { and, eq, inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { NO_ADJUSTMENTS, computePayrollLine, type PayrollDayInput } from '@mm/hr-core';
import * as s from '../src/lib/server/db/schema/index';

/**
 * Mock year of payroll to try the year-end tax screens on: one establishment, seven people, a released
 * payroll for each month of the year and the December payroll left as a draft to settle in.
 *
 *   pnpm exec tsx scripts/seed-mock-annual.ts          # create (replaces an earlier mock set)
 *   pnpm exec tsx scripts/seed-mock-annual.ts --clean  # remove it again
 *
 * Everything is tagged: the establishment slug `mock-annual`, employee numbers `MOCK-*`. The year is 2025 so
 * it stays out of the way of the real 2026 data.
 */
const YEAR = 2025;
const SLUG = 'mock-annual';
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema: s, casing: 'snake_case' });

const peso = (n: number) => Math.round(n * 100);
const ref = (p: string) => `${p}_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;

async function clean() {
	const est = await db.select({ id: s.establishments.id }).from(s.establishments).where(eq(s.establishments.slug, SLUG)).then((r) => r.at(0));
	const people = await db.select({ id: s.employees.id }).from(s.employees).where(like(s.employees.employeeNo, 'MOCK-%'));
	const ids = people.map((p) => p.id);
	if (est) {
		const batches = await db.select({ runId: s.payrollBatches.runId }).from(s.payrollBatches).where(eq(s.payrollBatches.establishmentId, est.id));
		const runIds = [...new Set(batches.map((b) => b.runId))];
		if (ids.length) await db.delete(s.payItems).where(inArray(s.payItems.employeeId, ids));
		const bb = await db.select({ id: s.bonusBatches.id }).from(s.bonusBatches).where(eq(s.bonusBatches.establishmentId, est.id));
		if (bb.length) {
			await db.delete(s.bonusLines).where(inArray(s.bonusLines.batchId, bb.map((b) => b.id)));
			await db.delete(s.bonusBatches).where(inArray(s.bonusBatches.id, bb.map((b) => b.id)));
		}
		if (runIds.length) await db.delete(s.payrollRuns).where(inArray(s.payrollRuns.id, runIds));
	}
	if (ids.length) {
		const seps = await db.select({ id: s.separations.id }).from(s.separations).where(inArray(s.separations.employeeId, ids));
		if (seps.length) {
			const sepIds = seps.map((x) => x.id);
			await db.delete(s.separationItems).where(inArray(s.separationItems.separationId, sepIds));
			await db.delete(s.separationClearance).where(inArray(s.separationClearance.separationId, sepIds));
			await db.delete(s.separations).where(inArray(s.separations.id, sepIds));
		}
		await db.delete(s.employeeAssignments).where(inArray(s.employeeAssignments.employeeId, ids));
		await db.delete(s.employees).where(inArray(s.employees.id, ids));
	}
	if (est) await db.delete(s.establishments).where(eq(s.establishments.id, est.id));
}

await clean();
if (process.argv.includes('--clean')) {
	console.log('mock data removed');
	await client.end();
	process.exit(0);
}

const org = await db.select().from(s.organizations).limit(1).then((r) => r[0]!);
const [est] = await db
	.insert(s.establishments)
	.values({ organizationId: org.id, kind: 'business', slug: SLUG, name: 'MOCK Annualization Co.', orgRef: ref('org') })
	.returning({ id: s.establishments.id });
const estId = est!.id;

type Spec = {
	no: string;
	first: string;
	last: string;
	rate: number;
	hired: string;
	/** Last month paid (1–12). */
	until?: number;
	exemptAllowance?: number;
	withholdingOverride?: number;
	exempt?: boolean;
	tin?: string;
	prev?: { taxable: number; withheld: number; name: string };
	bonus?: number;
	address?: string;
	separated?: string;
};
const SPECS: Spec[] = [
	{ no: 'MOCK-01', first: 'Maria', last: 'Santos', rate: 25_000, hired: '2022-03-01', tin: '123-456-789-000', address: '12 Rizal St, Cebu City' },
	{ no: 'MOCK-02', first: 'Jose', last: 'Reyes', rate: 60_000, hired: '2021-06-01', tin: '234-567-890-000', address: '88 Mabini Ave, Mandaue' },
	{ no: 'MOCK-03', first: 'Ana', last: 'Cruz', rate: 120_000, hired: '2019-01-15', tin: '345-678-901-000', address: '5 Lakeshore Dr, Lapu-Lapu', exemptAllowance: 3_000, bonus: 150_000 },
	{ no: 'MOCK-04', first: 'Pedro', last: 'Lim', rate: 30_000, hired: '2025-07-01', tin: '456-789-012-000', address: '41 Osmena Blvd, Cebu City', prev: { taxable: 150_000, withheld: 5_000, name: 'Visayas Trading Corp.' } },
	{ no: 'MOCK-05', first: 'Lita', last: 'Gomez', rate: 14_000, hired: '2023-02-01', tin: '567-890-123-000', address: '9 Colon St, Cebu City', exempt: true },
	{ no: 'MOCK-06', first: 'Ben', last: 'Torres', rate: 35_000, hired: '2020-05-01', until: 8, tin: '678-901-234-000', address: '27 Jones Ave, Cebu City', separated: `${YEAR}-08-31` },
	{ no: 'MOCK-07', first: 'Carla', last: 'Dizon', rate: 40_000, hired: '2022-09-01', tin: '789-012-345-000', address: '3 Gorordo Ave, Cebu City', withholdingOverride: 6_000 }
];

const day = (): PayrollDayInput => ({
	date: `${YEAR}-01-01`,
	dayKind: 'ordinary',
	scheduledWorkday: true,
	workedMinutes: 480,
	creditMinutes: 0,
	otMinutes: 0,
	unapprovedOtMinutes: 0,
	nightDiffMinutes: 0,
	tardinessMinutes: 0,
	undertimeMinutes: 0,
	punched: true
});

const emp = new Map<string, string>();
for (const p of SPECS) {
	const [e] = await db
		.insert(s.employees)
		.values({
			organizationId: org.id,
			personRef: ref('person'),
			employeeNo: p.no,
			firstName: p.first,
			lastName: p.last,
			birthdate: '1990-05-17',
			sex: 'female',
			hiredOn: p.hired,
			employmentType: 'regular',
			status: p.separated ? 'separated' : 'active',
			separatedOn: p.separated ?? null,
			payBasis: 'monthly',
			baseRateCentavos: peso(p.rate),
			govIds: p.tin ? { tin: p.tin } : {},
			withholdingExempt: !!p.exempt,
			coverageNote: p.exempt ? 'Minimum-wage earner (mock)' : null,
			address: p.address ?? null,
			prevEmployerYear: p.prev ? YEAR : null,
			prevEmployerName: p.prev?.name ?? null,
			prevEmployerTaxableCentavos: p.prev ? peso(p.prev.taxable) : 0,
			prevEmployerWithheldCentavos: p.prev ? peso(p.prev.withheld) : 0
		})
		.returning({ id: s.employees.id });
	emp.set(p.no, e!.id);
	await db.insert(s.employeeAssignments).values({
		employeeId: e!.id,
		establishmentId: estId,
		startDate: p.hired,
		endDate: p.separated ?? null,
		isPrimary: true,
		position: 'Staff'
	});
}

const lastDay = (m: number) => new Date(Date.UTC(YEAR, m, 0)).getUTCDate();
const pad = (n: number) => String(n).padStart(2, '0');
const basicByPerson = new Map<string, number>();

for (let m = 1; m <= 12; m++) {
	const draft = m === 12;
	const start = `${YEAR}-${pad(m)}-01`;
	const end = `${YEAR}-${pad(m)}-${pad(lastDay(m))}`;
	const [run] = await db
		.insert(s.payrollRuns)
		.values({
			organizationId: org.id,
			cutoffStart: start,
			cutoffEnd: end,
			payDate: end,
			frequency: 'monthly',
			dayFactor: 313,
			ratesCheckedAt: draft ? null : new Date()
		})
		.returning({ id: s.payrollRuns.id });
	const [batch] = await db
		.insert(s.payrollBatches)
		.values({
			runId: run!.id,
			establishmentId: estId,
			status: draft ? 'draft' : 'released',
			generatedAt: new Date(),
			lockedAt: draft ? null : new Date(),
			releasedAt: draft ? null : new Date()
		})
		.returning({ id: s.payrollBatches.id });

	for (const p of SPECS) {
		const hiredMonth = p.hired.startsWith(String(YEAR)) ? Number(p.hired.slice(5, 7)) : 1;
		if (m < hiredMonth || m > (p.until ?? 12)) continue;
		const exemptAllow = peso(p.exemptAllowance ?? 0);
		const r = computePayrollLine({
			personRef: ref('person'),
			costCenter: null,
			payBasis: 'monthly',
			baseRateCentavos: peso(p.rate),
			frequency: 'monthly',
			dayFactor: 313,
			nightDiffRate: 0.1,
			days: Array.from({ length: 26 }, day),
			exemptFromWithholding: !!p.exempt,
			adjustments: {
				...NO_ADJUSTMENTS,
				allowancesCentavos: exemptAllow,
				nonTaxableEarningsCentavos: exemptAllow,
				withholdingOverrideCentavos: p.withholdingOverride && !draft ? peso(p.withholdingOverride) : null
			}
		});
		basicByPerson.set(p.no, (basicByPerson.get(p.no) ?? 0) + r.line.earnings.basic);
		await db.insert(s.payrollRunLines).values({
			runId: run!.id,
			batchId: batch!.id,
			employeeId: emp.get(p.no)!,
			establishmentId: estId,
			personRef: ref('person'),
			employeeNo: p.no,
			employeeName: `${p.last}, ${p.first}`,
			position: 'Staff',
			payBasis: 'monthly',
			baseRateCentavos: peso(p.rate),
			govIds: p.tin ? { tin: p.tin } : {},
			daysWorked: 26,
			minutesRegular: 26 * 480,
			earnings: r.line.earnings,
			grossCentavos: r.line.gross,
			deductions: r.line.deductions,
			employerContributions: r.line.employer_contributions,
			netPayCentavos: r.line.net_pay,
			thirteenthMonthAccrualCentavos: r.line.thirteenth_month_accrual,
			adjustments: {
				...NO_ADJUSTMENTS,
				allowancesCentavos: exemptAllow,
				nonTaxableEarningsCentavos: exemptAllow,
				withholdingOverrideCentavos: p.withholdingOverride && !draft ? peso(p.withholdingOverride) : null
			},
			detail: {
				...r.detail,
				...(exemptAllow ? { payItems: [{ id: 'mock', kind: 'earning', category: 'allowance', label: 'Rice subsidy (de minimis)', amountCentavos: exemptAllow, taxable: false }] } : {})
			}
		});
	}
}

// A recurring tax-exempt benefit on Ana's record, so the pay item screens show one.
await db.insert(s.payItems).values({
	organizationId: org.id,
	employeeId: emp.get('MOCK-03')!,
	kind: 'earning',
	category: 'allowance',
	label: 'Rice subsidy (de minimis)',
	taxable: false,
	amountCentavos: peso(3_000),
	startDate: `${YEAR}-01-01`,
	endDate: null,
	note: 'Mock data'
});

// 13th month for everyone still employed, and a performance bonus that pushes Ana over ₱90,000.
const [yearEnd] = await db
	.insert(s.bonusBatches)
	.values({ organizationId: org.id, establishmentId: estId, kind: 'thirteenth_year_end', label: `13th month ${YEAR}`, year: YEAR, status: 'issued', issuedOn: `${YEAR}-12-20` })
	.returning({ id: s.bonusBatches.id });
const [perf] = await db
	.insert(s.bonusBatches)
	.values({ organizationId: org.id, establishmentId: estId, kind: 'other', label: 'Performance bonus', year: YEAR, status: 'issued', issuedOn: `${YEAR}-12-15` })
	.returning({ id: s.bonusBatches.id });
for (const p of SPECS) {
	const id = emp.get(p.no)!;
	const basic = basicByPerson.get(p.no) ?? 0;
	const accrued = Math.round(basic / 12);
	if (!p.separated) {
		await db.insert(s.bonusLines).values({
			batchId: yearEnd!.id,
			employeeId: id,
			employeeNo: p.no,
			employeeName: `${p.last}, ${p.first}`,
			position: 'Staff',
			basicEarnedCentavos: basic,
			accruedCentavos: accrued,
			amountCentavos: accrued
		});
	}
	if (p.bonus) {
		await db.insert(s.bonusLines).values({
			batchId: perf!.id,
			employeeId: id,
			employeeNo: p.no,
			employeeName: `${p.last}, ${p.first}`,
			position: 'Staff',
			amountCentavos: peso(p.bonus)
		});
	}
}

// Ben resigned in August; his pro-rated 13th month went out with his final pay.
const ben = SPECS.find((p) => p.separated)!;
const [sep] = await db
	.insert(s.separations)
	.values({ organizationId: org.id, employeeId: emp.get(ben.no)!, kind: 'resigned', lastDay: ben.separated!, status: 'cleared' })
	.returning({ id: s.separations.id });
await db.insert(s.separationItems).values({
	separationId: sep!.id,
	kind: 'credit',
	label: `13th month pay ${YEAR} (pro-rated)`,
	amountCentavos: Math.round((basicByPerson.get(ben.no) ?? 0) / 12),
	source: 'thirteenth_month',
	sourceYear: YEAR
});

console.log(`mock data created for ${YEAR}: ${SPECS.length} people, 12 monthly runs (December is a draft)`);
await client.end();
