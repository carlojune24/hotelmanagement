import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestEstablishments, createTestStaff, testOrgId } from './test-helpers';
import { eq } from 'drizzle-orm';

/**
 * Live-DB tests on a throwaway establishment: punches past scheduled end + overtime applications →
 * the DTR credits only approved overtime and flags the rest. Skipped without DATABASE_URL.
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

describe.skipIf(!hasDb)('DTR overtime applications (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const { employees, establishments } = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { applyShiftToCells } = await import('./schedules');
	const { computeMonthDtr, storePunches } = await import('./dtr-import');
	const { OvertimeError, cancelOvertime, fileOvertime: fileOvertimeAs, listOvertime } = await import('./overtime');
	// These tests model Main HR, who files and approves in one step.
	const fileOvertime = (est: string, input: Parameters<typeof fileOvertimeAs>[1], userId: string | null) =>
		fileOvertimeAs(est, input, userId, true);

	const tag = `dtrot-${Math.random().toString(36).slice(2, 10)}`;
	let establishment = '';
	let ann = '';
	const MONTH = '2026-03';
	const DAY = { isRestDay: false, startTime: '08:00', endTime: '17:00', breakMinutes: 60 };
	const MAP = { idColumn: 0, datetimeColumn: 1, hasHeader: false, dateFormat: 'ymd' as const };
	const file = (date: string, startTime: string, endTime: string) =>
		fileOvertime(establishment, { employeeId: ann, date, startTime, endTime, reason: '' }, null);
	const rec = async (date: string) =>
		(await computeMonthDtr(establishment, MONTH, ann)).records.find((r) => r.date === date);

	beforeAll(async () => {
		const [h] = await db
			.insert(establishments)
			.values({ organizationId: await testOrgId(), kind: 'business', slug: tag, name: 'DTR OT test', orgRef: mintRef('org'), timezone: 'Asia/Manila' })
			.returning({ id: establishments.id });
		establishment = h!.id;
		ann = await createTestStaff(establishment, { employeeNo: 'OT1', firstName: 'Ann', enrollId: '701' });
		const days = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05'];
		await applyShiftToCells(establishment, days.map((date) => ({ employeeId: ann, date })), DAY);
		await storePunches(
			establishment,
			days.flatMap((d) => [
				['701', `${d} 08:00:00`],
				['701', `${d} 17:30:00`]
			]),
			MAP,
			'ot.dat',
			MONTH,
			null
		);
	});

	afterAll(async () => {
		await cleanupTestEstablishments([establishment]);
	});

	it('flags overtime with no application and credits none of it', async () => {
		expect(await rec('2026-03-02')).toMatchObject({ otMinutes: 0, unapprovedOtMinutes: 30 });
	});

	it('credits only the part an application covers', async () => {
		await file('2026-03-03', '17:00', '17:15');
		expect(await rec('2026-03-03')).toMatchObject({ otMinutes: 15, unapprovedOtMinutes: 15 });
	});

	it('credits it all when the application covers the worked time', async () => {
		await file('2026-03-05', '17:00', '18:00');
		expect(await rec('2026-03-05')).toMatchObject({ otMinutes: 30, unapprovedOtMinutes: 0 });
	});

	it('a cancelled application no longer credits', async () => {
		const r = await file('2026-03-04', '17:00', '18:00');
		expect(await rec('2026-03-04')).toMatchObject({ otMinutes: 30 });
		await cancelOvertime(establishment, r.id, 'filed by mistake', null);
		expect(await rec('2026-03-04')).toMatchObject({ otMinutes: 0, unapprovedOtMinutes: 30 });
		await expect(cancelOvertime(establishment, r.id, '', null)).rejects.toBeInstanceOf(OvertimeError);
	});

	it('refuses an overlapping or empty application', async () => {
		await expect(file('2026-03-03', '17:10', '17:45')).rejects.toBeInstanceOf(OvertimeError);
		await expect(file('2026-03-09', '17:00', '17:00')).rejects.toBeInstanceOf(OvertimeError);
		const list = await listOvertime(establishment, '2026-03-01', '2026-03-31');
		expect(list.filter((x) => x.status === 'approved')).toHaveLength(2);
	});
});
