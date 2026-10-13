import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestEstablishments, createTestStaff, testOrgId } from './test-helpers';

/**
 * Live-DB tests for the DTR hand-off: once a month is with Main HR (submitted or received) a
 * manager cannot change its punches or records; Main HR can; returning it unlocks it again.
 * Throwaway establishment, removed afterwards. Skipped without a DB.
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

describe.skipIf(!hasDb)('DTR hand-off (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const { establishments } = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { applyShiftToCells } = await import('./schedules');
	const { DtrImportError, addManualPunch, listUploads, removePunch, removeUpload, saveMonthDtr, storePunches } =
		await import('./dtr-import');
	const {
		DtrSubmissionError,
		dtrBoard,
		getHandoff,
		handoffWarnings,
		listSubmittedDtr,
		receiveDtr,
		returnDtr,
		submitDtr
	} = await import('./dtr-submissions');

	const tag = `dtrho-${Math.random().toString(36).slice(2, 10)}`;
	const MONTH = '2026-03';
	const SHIFT = { isRestDay: false, startTime: '08:00', endTime: '17:00', breakMinutes: 60 };
	const MAP = { idColumn: 0, datetimeColumn: 1, hasHeader: false, dateFormat: 'ymd' as const };
	let est = '';
	let ana = '';
	let subId = '';

	beforeAll(async () => {
		const [e] = await db
			.insert(establishments)
			.values({
				organizationId: await testOrgId(),
				kind: 'business',
				slug: tag,
				name: 'DTR hand-off test',
				orgRef: mintRef('org'),
				timezone: 'Asia/Manila'
			})
			.returning({ id: establishments.id });
		est = e!.id;
		ana = await createTestStaff(est, { employeeNo: 'HO1', firstName: 'Ana', enrollId: '801' });
		await createTestStaff(est, { employeeNo: 'HO2', firstName: 'Bea', enrollId: '802' });
		await applyShiftToCells(est, ['2026-03-02', '2026-03-03'].map((date) => ({ employeeId: ana, date })), SHIFT, {
			approver: true
		});
	});
	afterAll(async () => {
		await cleanupTestEstablishments([est]);
	});

	it('cannot send a month with nothing saved', async () => {
		await expect(submitDtr(est, MONTH, null)).rejects.toThrow(DtrSubmissionError);
	});

	it('flags what is missing before sending', async () => {
		const w = await handoffWarnings(est, MONTH);
		expect(w.missingEmployees).toHaveLength(2);
		expect(w.unapprovedWeeks).toEqual(['2026-03-02']); // rostered, never approved
	});

	it('sends a saved month and locks it for managers', async () => {
		await storePunches(
			est,
			[
				['801', '2026-03-02 07:58:00'],
				['801', '2026-03-02 17:01:00'],
				['801', '2026-03-03 08:00:00'],
				['801', '2026-03-03 17:00:00']
			],
			MAP,
			'a.txt',
			MONTH,
			null
		);
		const saved = await saveMonthDtr(est, MONTH, ana);
		expect(saved.saved).toBeGreaterThan(0);

		await submitDtr(est, MONTH, null);
		expect((await getHandoff(est, MONTH)).status).toBe('submitted');
		// The hand-off exposes its id, so Main HR can receive or return it from the establishment's own DTR.
		expect((await getHandoff(est, MONTH)).id).toBeTruthy();
		expect((await getHandoff(est, '2099-12')).id).toBeNull();
		await expect(submitDtr(est, MONTH, null)).rejects.toThrow(/already/);
	});

	it('refuses every manager write to a locked month', async () => {
		await expect(saveMonthDtr(est, MONTH, ana)).rejects.toThrow(DtrImportError);
		await expect(addManualPunch(est, { enrollId: '801', date: '2026-03-04', time: '08:00', note: 'forgot' }, null)).rejects.toThrow(
			DtrImportError
		);
		await expect(storePunches(est, [['801', '2026-03-05 08:00:00']], MAP, 'b.txt', MONTH, null)).rejects.toThrow(DtrImportError);
		const [upload] = await listUploads(est, MONTH);
		await expect(removeUpload(est, upload!.id)).rejects.toThrow(DtrImportError);
		await expect(removePunch(est, '00000000-0000-0000-0000-000000000000')).resolves.toBeUndefined(); // unknown id: nothing to lock
	});

	it('lets Main HR still correct it', async () => {
		await expect(
			addManualPunch(est, { enrollId: '801', date: '2026-03-04', time: '08:00', note: 'forgot to punch' }, null, {
				approver: true
			})
		).resolves.toBeDefined();
		await expect(saveMonthDtr(est, MONTH, ana, { approver: true })).resolves.toBeDefined();
	});

	it('does not lock a different month', async () => {
		await expect(
			addManualPunch(est, { enrollId: '801', date: '2026-04-06', time: '08:00', note: 'other month' }, null)
		).resolves.toBeDefined();
	});

	it('appears in the inbox and the month board', async () => {
		const pending = await listSubmittedDtr();
		const mine = pending.find((p) => p.establishmentId === est);
		expect(mine).toBeDefined();
		expect(mine!.month).toBe(MONTH);
		subId = mine!.id;
		const board = await dtrBoard(MONTH);
		expect(board.find((b) => b.establishmentId === est)!.status).toBe('submitted');
		expect(await dtrBoard('2026-02')).toEqual(expect.arrayContaining([expect.objectContaining({ establishmentId: est, status: 'draft' })]));
	});

	it('stays locked once received, and cannot be received twice', async () => {
		await receiveDtr(subId, null);
		expect((await getHandoff(est, MONTH)).status).toBe('received');
		await expect(saveMonthDtr(est, MONTH, ana)).rejects.toThrow(/locked/);
		await expect(receiveDtr(subId, null)).rejects.toThrow(DtrSubmissionError);
		await expect(submitDtr(est, MONTH, null)).rejects.toThrow(/already received/);
	});

	it('returning needs a note, unlocks, and the manager can correct and resend', async () => {
		await expect(returnDtr(subId, '  ', null)).rejects.toThrow(DtrSubmissionError);
		await returnDtr(subId, 'Ana is missing the 9th', null);
		expect(await getHandoff(est, MONTH)).toMatchObject({ status: 'returned', note: 'Ana is missing the 9th' });

		await expect(saveMonthDtr(est, MONTH, ana)).resolves.toBeDefined();
		await submitDtr(est, MONTH, null);
		expect((await getHandoff(est, MONTH)).status).toBe('submitted');
		expect((await getHandoff(est, MONTH)).note).toBeNull();
	});
});
