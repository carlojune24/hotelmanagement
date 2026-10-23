import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestEstablishments, createTestStaff, testOrgId } from './test-helpers';

/**
 * Live-DB test: the leave card's running balance must end at the same `remaining` the Balances tab
 * shows, and a request's form must report the balance before and after it. Throwaway establishment.
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

describe.skipIf(!hasDb)('leave card (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const { establishments } = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { fileLeave, leaveBalances, listLeaveTypes, seedLeaveDefaults, addAdjustment } = await import('./leave');
	const { leaveCard, leaveForm } = await import('./leave-card');
	const { applyShiftToCells } = await import('./schedules');

	const tag = `cardtest-${Math.random().toString(36).slice(2, 10)}`;
	let est = '';
	let ana = '';
	let typeId = '';
	const SHIFT = { isRestDay: false, startTime: '08:00', endTime: '17:00', breakMinutes: 60 };

	beforeAll(async () => {
		const [e] = await db
			.insert(establishments)
			.values({
				organizationId: await testOrgId(),
				kind: 'business',
				slug: tag,
				name: 'Card test',
				orgRef: mintRef('org'),
				timezone: 'Asia/Manila'
			})
			.returning({ id: establishments.id });
		est = e!.id;
		ana = await createTestStaff(est, { employeeNo: 'LC1', firstName: 'Ana' });
		await seedLeaveDefaults(est);
		const t = (await listLeaveTypes(est)).find((x) => x.active && x.paid && x.daysPerYear > 0)!;
		typeId = t.id;
		await applyShiftToCells(
			est,
			['2026-03-10', '2026-03-11'].map((date) => ({ employeeId: ana, date })),
			SHIFT,
			{ approver: true }
		);
	});
	afterAll(async () => {
		await cleanupTestEstablishments([est]);
	});

	it('runs the balance down to the Balances tab figure and prints the request with before/after', async () => {
		const a = await fileLeave(
			est,
			{ employeeId: ana, leaveTypeId: typeId, startDate: '2026-03-10', endDate: '2026-03-10', halfDay: null, reason: 'Fiesta', documentNote: '' },
			null,
			true
		);
		await fileLeave(
			est,
			{ employeeId: ana, leaveTypeId: typeId, startDate: '2026-03-11', endDate: '2026-03-11', halfDay: 'am', reason: '', documentNote: '' },
			null,
			true
		);
		await addAdjustment(est, { employeeId: ana, leaveTypeId: typeId, year: 2026, days: 1, reason: 'Back pay' }, null);

		const card = await leaveCard(est, ana, 2026);
		const block = card!.blocks.find((b) => b.type.id === typeId)!;
		const sheet = (await leaveBalances(est, 2026)).rows.find((r) => r.employeeId === ana)!.lines.find((l) => l.typeId === typeId)!;

		expect(block.remaining).toBe(sheet.remaining);
		expect(block.entries.at(-1)!.balance).toBe(sheet.remaining);
		expect(block.entries.filter((e) => e.kind === 'leave')).toHaveLength(2);
		expect(block.entries.some((e) => e.kind === 'adjustment')).toBe(true);
		expect(card!.employee.hiredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

		const form = await leaveForm(est, a.request.id);
		expect(form!.after).toBe(sheet.remaining);
		expect(form!.before).toBe(Math.round((sheet.remaining + a.request.days) * 100) / 100);
	});
});
