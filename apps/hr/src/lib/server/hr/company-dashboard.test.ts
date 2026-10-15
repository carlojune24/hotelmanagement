import { describe, expect, it } from 'vitest';
import { testOrgId } from './test-helpers';

async function hasDb() {
	try {
		const { env } = await import('$env/dynamic/private');
		return Boolean(env.DATABASE_URL);
	} catch {
		return false;
	}
}
const live = await hasDb();

describe.skipIf(!live)('company dashboard (live DB)', async () => {
	const { getCompanyDashboard } = await import('./company-dashboard');

	it('builds against real data, urgent items first, and never throws on an empty source', async () => {
		const org = await testOrgId();
		const d = await getCompanyDashboard(org, '2026-10-15', { approver: true });
		const rank = { overdue: 0, soon: 1, info: 2 } as const;
		const ranks = d.attention.map((a) => rank[a.tone]);
		expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
		expect(new Set(d.attention.map((a) => a.key)).size).toBe(d.attention.length);
		for (const e of d.establishments) expect(e.staff).toBeGreaterThanOrEqual(0);
		for (const s of d.cutoff?.steps ?? []) expect(s.done).toBeLessThanOrEqual(s.of);
		expect(d.figures.headcount).toBeGreaterThanOrEqual(0);
	});
});
