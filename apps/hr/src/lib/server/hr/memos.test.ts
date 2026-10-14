import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestEstablishments, testOrgId } from './test-helpers';

const hasDb = Boolean(process.env.DATABASE_URL) || (await hasEnvFile());
async function hasEnvFile(): Promise<boolean> {
	try {
		const { env } = await import('$env/dynamic/private');
		return Boolean(env.DATABASE_URL);
	} catch {
		return false;
	}
}

describe.skipIf(!hasDb)('memo applications (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const { establishments } = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const C = await import('./calendar');
	const A = await import('./approvals');

	let est = '';
	const form = (date: string, name: string) => ({
		date,
		name,
		kind: 'memo' as const,
		creditHours: 4,
		waiveLateness: true
	});

	beforeAll(async () => {
		const [e] = await db
			.insert(establishments)
			.values({
				organizationId: await testOrgId(),
				kind: 'business',
				slug: `memo-${Math.random().toString(36).slice(2, 8)}`,
				name: 'Memo test',
				orgRef: mintRef('org')
			})
			.returning({ id: establishments.id });
		est = e!.id;
	});
	afterAll(async () => {
		await cleanupTestEstablishments([est]);
	});

	it('sends a memo with its reason, which affects nothing until Main HR approves it', async () => {
		const row = await C.proposeCalendarDay(est, form('2099-03-10', 'Fiesta early release'), null, '  Half day for the town fiesta.  ');
		expect(row).toMatchObject({ status: 'submitted', proposalNote: 'Half day for the town fiesta.' });

		// Not on any roster or DTR yet: the calendar the DTR reads only holds approved days.
		expect(await C.listCalendar(est, '2099-03-01', '2099-03-31')).toEqual([]);

		const pending = (await A.listPendingApprovals()).memos.find((m) => m.id === row.id);
		expect(pending).toMatchObject({ name: 'Fiesta early release', note: 'Half day for the town fiesta.' });

		const mine = await C.listMemoProposals(est);
		expect(mine.map((m) => [m.name, m.status])).toEqual([['Fiesta early release', 'submitted']]);
	});

	it('shows the decision, and only an approved memo reaches the calendar', async () => {
		const [first] = await C.listMemoProposals(est);
		await expect(C.decideCalendarDay(first!.id, 'rejected', '', null)).rejects.toThrow(/reason/);
		await C.decideCalendarDay(first!.id, 'rejected', 'Already covered by the holiday.', null);

		const second = await C.proposeCalendarDay(est, form('2099-03-12', 'Training day'), null);
		await C.decideCalendarDay(second.id, 'approved', '', null);

		const list = await C.listMemoProposals(est);
		expect(Object.fromEntries(list.map((m) => [m.name, m.status]))).toEqual({
			'Fiesta early release': 'rejected',
			'Training day': 'approved'
		});
		expect(list.find((m) => m.status === 'rejected')?.decisionNote).toBe('Already covered by the holiday.');
		expect((await C.listCalendar(est, '2099-03-01', '2099-03-31')).map((d) => d.name)).toEqual(['Training day']);
	});

	it('refuses a second entry for the same date', async () => {
		await expect(C.proposeCalendarDay(est, form('2099-03-12', 'Again'), null)).rejects.toThrow(/already has an entry/);
	});
});
