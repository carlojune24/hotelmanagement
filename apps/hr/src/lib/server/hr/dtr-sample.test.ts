import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { cleanupTestEstablishments, createTestStaff, testOrgId } from './test-helpers';
import { SCENARIOS, SAMPLE_DATE, evaluate, type Scenario } from '../../dtr-scenarios';

/**
 * Every DTR Guide scenario run through the whole real path on a throwaway establishment: roster →
 * uploaded biometric punches → overtime / leave / memo → computeMonthDtr, then compared with what the
 * Guide says. `KEEP_SAMPLE=1 pnpm vitest run src/lib/server/hr/dtr-sample.test.ts` leaves "DTR sample hotel"
 * (one person per scenario group, March 2026) in the database to browse and writes the punches to
 * `scripts/sample-dtr-march-2026.csv` for a manual upload. Remove it with scripts/remove-dtr-sample.sql.
 */
const hasDb = Boolean(process.env.DATABASE_URL) || (await hasEnvFile());

async function hasEnvFile(): Promise<boolean> {
	try {
		const { env } = await import('$env/dynamic/private');
		return Boolean(env.DATABASE_URL);
	} catch {
		return false;
	}
}

const ENROLL: Record<Scenario['group'], string> = {
	split: '9101',
	plain: '9102',
	night: '9103',
	overtime: '9104',
	leave: '9105',
	absence: '9106'
};
const GROUP_NAME: Record<Scenario['group'], string> = {
	split: 'Split',
	plain: 'Straight',
	night: 'Night',
	overtime: 'Overtime',
	leave: 'Leave',
	absence: 'Absence'
};

/** The March 2026 date each scenario lives on: one day per scenario, per person. */
function dateOf(sc: Scenario): string {
	const idx = SCENARIOS.filter((s) => s.group === sc.group).findIndex((s) => s.id === sc.id);
	const day = sc.group === 'leave' ? 17 + idx : 1 + idx;
	return `2026-03-${String(day).padStart(2, '0')}`;
}
const nextDay = (d: string) => {
	const [y, m, dd] = d.split('-').map(Number);
	return new Date(Date.UTC(y!, m! - 1, dd! + 1)).toISOString().slice(0, 10);
};
const punchTimestamp = (date: string, t: string) =>
	t.endsWith('+1') ? `${nextDay(date)} ${t.slice(0, -2)}:00` : `${date} ${t}:00`;

describe.skipIf(!hasDb)('DTR Guide scenarios on real data (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const { establishments, leaveTypes, employees } = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { and, eq, inArray } = await import('drizzle-orm');
	const { applyShiftToCells } = await import('./schedules');
	const { computeMonthDtr, storePunches } = await import('./dtr-import');
	const { fileOvertime } = await import('./overtime');
	const { fileLeave, saveLeaveType } = await import('./leave');
	const { saveCalendarDay } = await import('./calendar');

	const tag = `dtr-sample-${Math.random().toString(36).slice(2, 8)}`;
	const MONTH = '2026-03';
	const MAP = { idColumn: 0, datetimeColumn: 1, hasHeader: false, dateFormat: 'ymd' as const };
	const keep = Boolean(process.env.KEEP_SAMPLE);
	let est = '';
	const people = new Map<Scenario['group'], string>();
	const leaveCodes = [`P${tag.slice(-4).toUpperCase()}`, `U${tag.slice(-4).toUpperCase()}`];

	const SHIFT = {
		split: { isRestDay: false, startTime: '08:00', endTime: '17:00', breakMinutes: 60, breakStart: '12:00', breakEnd: '13:00' },
		plain: { isRestDay: false, startTime: '08:00', endTime: '17:00', breakMinutes: 60 },
		night: { isRestDay: false, startTime: '22:00', endTime: '06:00', breakMinutes: 60, breakStart: '02:00', breakEnd: '03:00' },
		rest: { isRestDay: true, startTime: null, endTime: null, breakMinutes: 0 }
	} as const;

	beforeAll(async () => {
		const [h] = await db
			.insert(establishments)
			.values({ organizationId: await testOrgId(), kind: 'business', slug: tag, name: 'DTR sample hotel', orgRef: mintRef('org'), timezone: 'Asia/Manila' })
			.returning({ id: establishments.id });
		est = h!.id;
		let n = 1;
		for (const g of Object.keys(ENROLL) as Scenario['group'][]) {
			people.set(g, await createTestStaff(est, { employeeNo: `DS${n++}`, firstName: GROUP_NAME[g], enrollId: ENROLL[g], position: 'Sample' }));
		}

		const paid = await saveLeaveType(est, {
			code: leaveCodes[0]!, name: 'Sample paid leave', description: '', paid: true, daysPerYear: 60, dayCount: 'working',
			minServiceMonths: 0, employmentTypes: [], sexRestriction: null, halfDayAllowed: true, carryOverDays: 0,
			cashConvertible: false, requiresDocument: false, active: true
		});
		const unpaid = await saveLeaveType(est, {
			code: leaveCodes[1]!, name: 'Sample unpaid leave', description: '', paid: false, daysPerYear: 60, dayCount: 'working',
			minServiceMonths: 0, employmentTypes: [], sexRestriction: null, halfDayAllowed: true, carryOverDays: 0,
			cashConvertible: false, requiresDocument: false, active: true
		});
		const paidId = paid.after.id;
		const unpaidId = unpaid.after.id;

		const csv: string[] = [];
		for (const sc of SCENARIOS) {
			const emp = people.get(sc.group)!;
			const date = dateOf(sc);
			if (sc.schedule !== 'none') {
				const shift = sc.schedule === 'rest' ? SHIFT.rest : sc.schedule === 'night' ? SHIFT.night : sc.schedule === 'plain' ? SHIFT.plain : SHIFT.split;
				await applyShiftToCells(est, [{ employeeId: emp, date }], shift);
			}
			for (const t of sc.punches) csv.push(`${ENROLL[sc.group]},${punchTimestamp(date, t)}`);
			for (const r of sc.approvedOt ?? []) {
				const [a, b] = r.split('-') as [string, string];
				await fileOvertime(est, { employeeId: emp, date, startTime: a, endTime: b, reason: sc.id }, null, true);
			}
			if (sc.leave) {
				await fileLeave(
					est,
					{ employeeId: emp, leaveTypeId: sc.leave.paid ? paidId : unpaidId, startDate: date, endDate: date, halfDay: sc.leave.halfDay, reason: sc.id, documentNote: '' },
					null,
					true
				);
			}
			if (sc.memo) {
				await saveCalendarDay(est, { date, name: `Sample ${sc.id}`, kind: 'memo', creditHours: sc.memo.creditHours, waiveLateness: sc.memo.waiveLateness });
			}
		}
		// One uploaded "file", through the same path the Biometric data page uses.
		await storePunches(est, csv.map((l) => l.split(',')), MAP, 'dtr-sample-march-2026.csv', MONTH, null);
		if (keep) {
			writeFileSync(new URL('../../../../scripts/sample-dtr-march-2026.csv', import.meta.url), csv.join('\n') + '\n');
		}
		void SAMPLE_DATE;
	});

	afterAll(async () => {
		if (keep) return;
		await cleanupTestEstablishments([est]);
		await db.delete(leaveTypes).where(inArray(leaveTypes.code, leaveCodes));
		void employees;
		void and;
		void eq;
	});

	for (const sc of SCENARIOS) {
		it(`${sc.id} ${sc.title}`, async () => {
			const emp = people.get(sc.group)!;
			const date = dateOf(sc);
			const month = await computeMonthDtr(est, MONTH, emp);
			const rec = month.records.find((r) => r.date === date);
			const want = evaluate(sc);
			if (!rec) {
				// Nothing is generated for a rest day with no punches or a day with nothing at all.
				expect(want.worked).toBe(0);
				expect(want.absent).toBe(false);
				return;
			}
			expect(rec.workedMinutes, 'worked').toBe(want.worked);
			expect(rec.tardinessMinutes, 'late').toBe(want.late);
			expect(rec.undertimeMinutes, 'under').toBe(want.under);
			expect(rec.otMinutes, 'ot').toBe(want.ot);
			expect(rec.unapprovedOtMinutes, 'unapproved ot').toBe(want.unapprovedOt);
			expect(rec.isAbsent, 'absent').toBe(want.absent);
			expect(rec.leaveMinutes, 'leave credit').toBe(want.leaveCredit);
			expect([...rec.flags].sort(), 'flags').toEqual([...want.flags].sort());
		});
	}
});
