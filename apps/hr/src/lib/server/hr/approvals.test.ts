import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestEstablishments, createTestStaff, testOrgId } from './test-helpers';

/**
 * Live-DB tests for the approval flow: what a manager files waits as `submitted` and affects nothing
 * until Main HR approves it. Throwaway establishment, removed afterwards. Skipped without a DB.
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

describe.skipIf(!hasDb)('approvals (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const { establishments } = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { LeaveError, cancelLeave, decideLeave, fileLeave, leaveBalances, listLeaveDays, listLeaveTypes } =
		await import('./leave');
	const { OvertimeError, decideOvertime, fileOvertime, listApprovedOvertime } = await import('./overtime');
	const { PeriodError, decideWeek, getWeek, submitWeek } = await import('./schedule-periods');
	const { applyShiftToCells, clearCells } = await import('./schedules');
	const { listPendingApprovals } = await import('./approvals');

	const tag = `apptest-${Math.random().toString(36).slice(2, 10)}`;
	let est = '';
	let ana = '';
	let sick = { id: '', code: '' };
	const SHIFT = { isRestDay: false, startTime: '08:00', endTime: '17:00', breakMinutes: 60 };
	const MON = '2026-03-02'; // a Monday
	const leaveInput = (startDate: string, endDate = startDate) => ({
		employeeId: ana,
		leaveTypeId: sick.id,
		startDate,
		endDate,
		halfDay: null,
		reason: '',
		documentNote: ''
	});

	beforeAll(async () => {
		const [e] = await db
			.insert(establishments)
			.values({
				organizationId: await testOrgId(),
				kind: 'business',
				slug: tag,
				name: 'Approvals test',
				orgRef: mintRef('org'),
				timezone: 'Asia/Manila'
			})
			.returning({ id: establishments.id });
		est = e!.id;
		ana = await createTestStaff(est, { employeeNo: 'AP1', firstName: 'Ana' });
		// Leave types are seeded lazily by the settings screen; this makes one for the test.
		const { seedLeaveDefaults } = await import('./leave');
		await seedLeaveDefaults(est);
		const types = await listLeaveTypes(est);
		const t = types.find((x) => x.active && x.paid) ?? types[0]!;
		sick = { id: t.id, code: t.code };
		// Leave counts working days, so the days used below must be rostered first.
		const days = ['2026-03-10', '2026-03-20', '2026-03-24', '2026-03-26', '2026-03-30'];
		await applyShiftToCells(est, days.map((date) => ({ employeeId: ana, date })), SHIFT, { approver: true });
	});
	afterAll(async () => {
		await cleanupTestEstablishments([est]);
	});

	describe('leave', () => {
		let id = '';
		it('a manager files it as submitted, and it does not reach the roster/DTR', async () => {
			const r = await fileLeave(est, leaveInput('2026-03-10'), null, false);
			id = r.request.id;
			expect(r.request.status).toBe('submitted');
			expect((await listLeaveDays(est, '2026-03-01', '2026-03-31')).size).toBe(0);
		});

		it('main HR filing is approved on the spot (parity with before)', async () => {
			const r = await fileLeave(est, leaveInput('2026-03-20'), null, true);
			expect(r.request.status).toBe('approved');
			expect((await listLeaveDays(est, '2026-03-01', '2026-03-31')).size).toBeGreaterThan(0);
			await cancelLeave(est, r.request.id, '', null);
		});

		it('a waiting request blocks a duplicate on the same dates', async () => {
			await expect(fileLeave(est, leaveInput('2026-03-10'), null, false)).rejects.toThrow(LeaveError);
		});

		it('rejecting needs a reason; approving makes it count', async () => {
			await expect(decideLeave(id, 'rejected', '  ', null)).rejects.toThrow(LeaveError);
			const row = await decideLeave(id, 'approved', '', null);
			expect(row.status).toBe('approved');
			expect((await listLeaveDays(est, '2026-03-01', '2026-03-31')).size).toBeGreaterThan(0);
		});

		it('cannot be decided twice', async () => {
			await expect(decideLeave(id, 'rejected', 'changed my mind', null)).rejects.toThrow(LeaveError);
		});

		it('a manager may withdraw a waiting request but not cancel an approved one', async () => {
			const waiting = await fileLeave(est, leaveInput('2026-03-24'), null, false);
			await expect(cancelLeave(est, waiting.request.id, '', null, { onlySubmitted: true })).resolves.toBeDefined();
			await expect(cancelLeave(est, id, '', null, { onlySubmitted: true })).rejects.toThrow(LeaveError);
		});

		it('a rejected request counts for nothing and keeps the reason', async () => {
			const r = await fileLeave(est, leaveInput('2026-03-26'), null, false);
			const row = await decideLeave(r.request.id, 'rejected', 'Short-staffed that week', null);
			expect(row).toMatchObject({ status: 'rejected', decisionNote: 'Short-staffed that week' });
			const days = await listLeaveDays(est, '2026-03-26', '2026-03-26');
			expect(days.size).toBe(0);
		});

		it('shows the person on the balances sheet', async () => {
			const { rows } = await leaveBalances(est, 2026);
			expect(rows.find((r) => r.employeeId === ana)).toBeDefined();
		});
	});

	describe('overtime', () => {
		let id = '';
		it('submitted overtime is not credited; approved overtime is', async () => {
			const r = await fileOvertime(est, { employeeId: ana, date: '2026-03-03', startTime: '17:00', endTime: '18:00', reason: 'x' }, null, false);
			id = r.id;
			expect(r.status).toBe('submitted');
			expect((await listApprovedOvertime(est, '2026-03-01', '2026-03-31')).size).toBe(0);
			await decideOvertime(id, 'approved', '', null);
			expect((await listApprovedOvertime(est, '2026-03-01', '2026-03-31')).size).toBe(1);
		});
		it('a waiting application blocks an overlapping one and rejection needs a reason', async () => {
			const r = await fileOvertime(est, { employeeId: ana, date: '2026-03-04', startTime: '17:00', endTime: '18:00', reason: '' }, null, false);
			await expect(
				fileOvertime(est, { employeeId: ana, date: '2026-03-04', startTime: '17:30', endTime: '18:30', reason: '' }, null, false)
			).rejects.toThrow(OvertimeError);
			await expect(decideOvertime(r.id, 'rejected', '', null)).rejects.toThrow(OvertimeError);
		});
	});

	describe('roster weeks', () => {
		it('cannot submit an empty week or a non-Monday', async () => {
			await expect(submitWeek(est, '2026-04-06', null)).rejects.toThrow(PeriodError);
			await expect(submitWeek(est, '2026-04-08', null)).rejects.toThrow(PeriodError);
		});

		it('draft → submitted → (manager edits) → draft', async () => {
			await applyShiftToCells(est, [{ employeeId: ana, date: MON }], SHIFT);
			expect((await getWeek(est, MON)).status).toBe('draft');
			await submitWeek(est, MON, null);
			expect((await getWeek(est, MON)).status).toBe('submitted');
			await expect(submitWeek(est, MON, null)).rejects.toThrow(PeriodError);

			await applyShiftToCells(est, [{ employeeId: ana, date: '2026-03-03' }], SHIFT); // manager edit
			expect((await getWeek(est, MON)).status).toBe('draft');
		});

		it('returning needs a note and the note is kept for the manager', async () => {
			await submitWeek(est, MON, null);
			await expect(decideWeek(est, MON, 'returned', ' ', null)).rejects.toThrow(PeriodError);
			await decideWeek(est, MON, 'returned', 'Cover Sunday', null);
			expect(await getWeek(est, MON)).toMatchObject({ status: 'returned', note: 'Cover Sunday' });
		});

		it('approved stays approved when the approver edits, but a manager edit reopens it', async () => {
			await submitWeek(est, MON, null);
			await decideWeek(est, MON, 'approved', '', null);
			expect((await getWeek(est, MON)).status).toBe('approved');

			await clearCells(est, [{ employeeId: ana, date: '2026-03-03' }], { approver: true });
			expect((await getWeek(est, MON)).status).toBe('approved');

			await applyShiftToCells(est, [{ employeeId: ana, date: '2026-03-03' }], SHIFT); // manager
			expect((await getWeek(est, MON)).status).toBe('draft');
		});

		it('only a submitted week can be decided', async () => {
			await expect(decideWeek(est, MON, 'approved', '', null)).rejects.toThrow(PeriodError);
		});
	});

	it('the inbox lists exactly what is waiting', async () => {
		await submitWeek(est, MON, null);
		const w = await fileLeave(est, leaveInput('2026-03-30'), null, false);
		const pending = await listPendingApprovals();
		expect(pending.weeks.some((x) => x.establishmentId === est && x.weekStart === MON)).toBe(true);
		expect(pending.leave.some((x) => x.id === w.request.id)).toBe(true);
	});
});
