import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

/**
 * Live-DB tests on a throwaway hotel: biometric punches + roster + leave + calendar → the
 * generated DTR, then saved. Deletes only what it created. Skipped without DATABASE_URL.
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

describe.skipIf(!hasDb)('DTR with leave, holidays and biometric punches (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const { dtrEntries, employees, hotels } = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { applyShiftToCells } = await import('./schedules');
	const { addManualPunch, computeMonthDtr, saveMonthDtr, storePunches, removeUpload, listUploads } =
		await import('./dtr-import');
	const { LeaveError, cancelLeave, fileLeave, leaveBalances, listLeaveTypes, saveLeaveType } = await import('./leave');
	const { saveCalendarDay } = await import('./calendar');

	const tag = `dtrleave-${Math.random().toString(36).slice(2, 10)}`;
	let hotel = '';
	let ann = ''; // enroll id 501, regular, hired 2024
	let newbie = ''; // hired recently: not eligible for SIL
	const DAY = { isRestDay: false, startTime: '08:00', endTime: '17:00', breakMinutes: 60 };
	const REST = { isRestDay: true, startTime: null, endTime: null, breakMinutes: 0 };
	const MONTH = '2026-03'; // fully in the past relative to the test clock

	const mkEmployee = async (no: string, first: string, hiredOn: string, enroll: string | null) => {
		const [e] = await db
			.insert(employees)
			.values({
				hotelId: hotel,
				personRef: mintRef('person'),
				employeeNo: no,
				firstName: first,
				lastName: 'Test',
				birthdate: '1990-01-01',
				sex: 'female',
				hiredOn,
				employmentType: 'regular',
				position: 'Tester',
				payBasis: 'monthly',
				baseRateCentavos: 1_000_000,
				biometricEnrollId: enroll
			})
			.returning({ id: employees.id });
		return e!.id;
	};

	// ATTLOG-style rows: id, datetime
	const rows = (...punches: Array<[string, string]>) => punches.map(([id, dt]) => [id, dt]);
	const MAP = { idColumn: 0, datetimeColumn: 1, hasHeader: false, dateFormat: 'ymd' as const };

	beforeAll(async () => {
		const [h] = await db
			.insert(hotels)
			.values({ slug: tag, name: 'DTR leave test', orgRef: mintRef('org'), timezone: 'Asia/Manila' })
			.returning({ id: hotels.id });
		hotel = h!.id;
		ann = await mkEmployee('T1', 'Ann', '2024-01-01', '501');
		newbie = await mkEmployee('T2', 'Newbie', '2026-02-01', '502');

		// Mon–Fri 2–6 March rostered, weekend rest; 9–13 rostered too.
		const work = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13'];
		await applyShiftToCells(hotel, work.map((date) => ({ employeeId: ann, date })), DAY);
		await applyShiftToCells(hotel, ['2026-03-07', '2026-03-08'].map((date) => ({ employeeId: ann, date })), REST);

		// Ann punches only on the 2nd, 3rd (late) and 4th.
		await storePunches(
			hotel,
			rows(
				['501', '2026-03-02 07:55:00'],
				['501', '2026-03-02 17:02:00'],
				['501', '2026-03-03 08:20:00'],
				['501', '2026-03-03 17:00:00'],
				['501', '2026-03-04 08:00:00'],
				['501', '2026-03-04 17:00:00']
			),
			MAP,
			'march.dat',
			MONTH,
			null
		);
	});

	afterAll(async () => {
		await db.delete(hotels).where(eq(hotels.id, hotel));
	});

	const annRec = async (date: string) => {
		const r = await computeMonthDtr(hotel, MONTH, ann);
		return r.records.find((x) => x.date === date);
	};

	it('computes lateness from punches and marks unpunched past work days absent', async () => {
		const late = await annRec('2026-03-03');
		expect(late).toMatchObject({ tardinessMinutes: 20, isAbsent: false });
		const absent = await annRec('2026-03-05');
		expect(absent?.isAbsent).toBe(true);
		expect(await annRec('2026-03-07')).toBeUndefined(); // rest day: nothing
	});

	it('re-uploading the same file adds nothing and leaves no empty file record', async () => {
		const again = await storePunches(
			hotel,
			rows(['501', '2026-03-02 07:55:00'], ['501', '2026-03-02 17:02:00']),
			MAP,
			'march-again.dat',
			MONTH,
			null
		);
		expect(again.inserted).toBe(0);
		const files = await listUploads(hotel, MONTH);
		expect(files.map((f) => f.fileName)).toEqual(['march.dat']);
	});

	it('a staff-added punch fills a forgotten clock-out', async () => {
		await storePunches(hotel, rows(['501', '2026-03-12 08:00:00']), MAP, 'late.dat', MONTH, null);
		const before = await annRec('2026-03-12');
		expect(before?.flags).toContain('single_punch');
		await addManualPunch(hotel, { enrollId: '501', date: '2026-03-12', time: '17:00', note: 'Supervisor confirmed' }, null);
		const after = await annRec('2026-03-12');
		expect(after?.manualPunch).toBe(true);
		expect(after?.undertimeMinutes).toBe(0);
		expect(after?.workedMinutes).toBe(480);
	});

	it('removing a file deletes its punches but keeps staff-added ones', async () => {
		const [file] = (await listUploads(hotel, MONTH)).filter((f) => f.fileName === 'late.dat');
		await removeUpload(hotel, file!.id);
		const r = await annRec('2026-03-12');
		expect(r?.manualPunch).toBe(true);
		expect(r?.flags).toContain('single_punch'); // only the manual 17:00 remains
	});

	it('paid leave on a rostered day replaces the absence and credits the shift', async () => {
		await listLeaveTypes(hotel); // seeds defaults
		const types = await listLeaveTypes(hotel);
		const sick = types.find((t) => t.code === 'SL')!;
		await saveLeaveType(
			hotel,
			{
				code: 'SL', name: 'Sick Leave', description: '', paid: true, daysPerYear: 5, dayCount: 'working',
				minServiceMonths: 0, employmentTypes: [], sexRestriction: null, halfDayAllowed: true,
				carryOverDays: 0, cashConvertible: false, requiresDocument: false, active: true
			},
			sick.id
		);
		const filed = await fileLeave(
			hotel,
			{ employeeId: ann, leaveTypeId: sick.id, startDate: '2026-03-05', endDate: '2026-03-06', halfDay: null, reason: 'Flu', documentNote: '' },
			null
		);
		expect(filed.request.days).toBe(2);
		const r = await annRec('2026-03-05');
		expect(r).toMatchObject({ isAbsent: false, workedMinutes: 480, leaveMinutes: 480 });
		expect(r?.leave?.code).toBe('SL');

		// balance fell by two
		const bal = (await leaveBalances(hotel, 2026)).rows.find((x) => x.employeeId === ann)!;
		expect(bal.lines.find((l) => l.typeId === sick.id)?.remaining).toBe(3);

		// overlapping request refused; over-balance refused
		await expect(
			fileLeave(hotel, { employeeId: ann, leaveTypeId: sick.id, startDate: '2026-03-06', endDate: '2026-03-06', halfDay: null, reason: '', documentNote: '' }, null)
		).rejects.toBeInstanceOf(LeaveError);
		await expect(
			fileLeave(hotel, { employeeId: ann, leaveTypeId: sick.id, startDate: '2026-03-09', endDate: '2026-03-13', halfDay: null, reason: '', documentNote: '' }, null)
		).rejects.toThrow(/more than/);

		// cancelling restores the absence
		await cancelLeave(hotel, filed.request.id, 'test', null);
		expect((await annRec('2026-03-05'))?.isAbsent).toBe(true);
	});

	it('is not open to someone without enough service', async () => {
		const sil = (await listLeaveTypes(hotel)).find((t) => t.code === 'SIL')!;
		await expect(
			fileLeave(hotel, { employeeId: newbie, leaveTypeId: sil.id, startDate: '2026-03-09', endDate: '2026-03-09', halfDay: null, reason: '', documentNote: '' }, null)
		).rejects.toThrow(/12 months/);
	});

	it('unpaid leave credits nothing; leave on an unscheduled date is credited a usual 8h when paid', async () => {
		const types = await listLeaveTypes(hotel);
		const pl = types.find((t) => t.code === 'PL')!;
		// PL is for male employees only: allow everyone for this check
		await saveLeaveType(
			hotel,
			{
				code: 'PL', name: 'Paternity Leave', description: '', paid: true, daysPerYear: 7, dayCount: 'calendar',
				minServiceMonths: 0, employmentTypes: [], sexRestriction: null, halfDayAllowed: false,
				carryOverDays: 0, cashConvertible: false, requiresDocument: false, active: true
			},
			pl.id
		);
		await fileLeave(
			hotel,
			{ employeeId: ann, leaveTypeId: pl.id, startDate: '2026-03-16', endDate: '2026-03-17', halfDay: null, reason: '', documentNote: '' },
			null
		);
		const r = await annRec('2026-03-16'); // no roster row that day
		expect(r).toMatchObject({ isAbsent: false, workedMinutes: 480, scheduleId: null });
	});

	it('a holiday credits everyone scheduled and waives lateness when set', async () => {
		await saveCalendarDay(hotel, { date: '2026-03-03', name: 'Test Memo', kind: 'memo', creditHours: null, waiveLateness: true });
		const r = await annRec('2026-03-03'); // Ann was 20 min late that day
		expect(r?.tardinessMinutes).toBe(0);
		expect(r?.calendar?.name).toBe('Test Memo');
		await saveCalendarDay(hotel, { date: '2026-03-10', name: 'Half memo', kind: 'memo', creditHours: 4, waiveLateness: false });
		const half = await annRec('2026-03-10'); // rostered, no punches
		expect(half).toMatchObject({ isAbsent: false, workedMinutes: 240 });
	});

	it('saving writes leave/holiday rows and replaces them on the next save', async () => {
		const first = await saveMonthDtr(hotel, MONTH, ann);
		expect(first.saved).toBeGreaterThan(0);
		const saved = await db.select().from(dtrEntries).where(eq(dtrEntries.employeeId, ann));
		const memo = saved.find((e) => e.date === '2026-03-10');
		expect(memo).toMatchObject({ source: 'calendar', isAbsent: false, workedMinutes: 240 });
		expect(memo?.remarks).toBe('Half memo');
		const leave = saved.find((e) => e.date === '2026-03-16');
		expect(leave).toMatchObject({ source: 'leave', leaveMinutes: 480 });

		const again = await saveMonthDtr(hotel, MONTH, ann);
		const count = await db.select({ id: dtrEntries.id }).from(dtrEntries).where(eq(dtrEntries.employeeId, ann));
		expect(count.length).toBe(again.saved); // replaced, not duplicated
	});

	it('never touches a staff-entered row on save', async () => {
		await db.delete(dtrEntries).where(inArray(dtrEntries.employeeId, [ann]));
		await db.insert(dtrEntries).values({ hotelId: hotel, employeeId: ann, date: '2026-03-04', source: 'manual', workedMinutes: 123 });
		const r = await saveMonthDtr(hotel, MONTH, ann);
		expect(r.keptManual).toBeGreaterThan(0);
		const kept = await db.select().from(dtrEntries).where(eq(dtrEntries.employeeId, ann));
		expect(kept.find((e) => e.date === '2026-03-04')).toMatchObject({ source: 'manual', workedMinutes: 123 });
	});
});
