import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestEstablishments, createTestStaff, testOrgId } from './test-helpers';

const hasDb = Boolean(process.env.DATABASE_URL) || (await hasEnvFile());
async function hasEnvFile(): Promise<boolean> {
	try {
		const { env } = await import('$env/dynamic/private');
		return Boolean(env.DATABASE_URL);
	} catch {
		return false;
	}
}

describe('dashboard scope', () => {
	it('treats only per-establishment access as scoped', async () => {
		const { isEstablishmentScoped } = await import('../scope');
		const user = { isSystemAdmin: false };
		expect(isEstablishmentScoped(user, { orgCaps: [], establishments: { e1: ['employee:read'] } })).toBe(true);
		expect(isEstablishmentScoped(user, { orgCaps: ['*'], establishments: {} })).toBe(false);
		expect(isEstablishmentScoped(user, { orgCaps: [], establishments: {} })).toBe(false);
		expect(isEstablishmentScoped({ isSystemAdmin: true }, { orgCaps: [], establishments: { e1: [] } })).toBe(false);
	});
});

describe.skipIf(!hasDb)('establishment dashboard (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const { announcements, establishments, leaveRequests, leaveTypes, schedules } = await import(
		'$lib/server/db/schema/index'
	);
	const { mintRef } = await import('$lib/server/ids');
	const { eq } = await import('drizzle-orm');
	const D = await import('./dashboard');
	const A = await import('./announcements');

	const tag = `dash-${Math.random().toString(36).slice(2, 8)}`;
	const today = '2026-06-10'; // a Wednesday
	let org = '';
	let est = '';
	let other = '';
	let ana = '';
	let bo = '';
	let cy = '';
	const noticeIds: string[] = [];

	const mkEst = async (suffix: string) => {
		const [e] = await db
			.insert(establishments)
			.values({ organizationId: org, kind: 'business', slug: `${tag}-${suffix}`, name: `Dash ${suffix}`, orgRef: mintRef('org') })
			.returning({ id: establishments.id });
		return e!.id;
	};

	beforeAll(async () => {
		org = await testOrgId();
		est = await mkEst('a');
		other = await mkEst('b');
		ana = await createTestStaff(est, { employeeNo: 'D1', firstName: 'Ana' });
		bo = await createTestStaff(est, { employeeNo: 'D2', firstName: 'Bo' });
		cy = await createTestStaff(est, { employeeNo: 'D3', firstName: 'Cy' });
		// Ana works today, Bo is on a rest day, Cy is on approved leave (so not counted as working).
		await db.insert(schedules).values([
			{ establishmentId: est, employeeId: ana, date: today, isRestDay: false, startTime: '08:00', endTime: '17:00', breakMinutes: 60 },
			{ establishmentId: est, employeeId: bo, date: today, isRestDay: true },
			{ establishmentId: est, employeeId: cy, date: today, isRestDay: false, startTime: '08:00', endTime: '17:00', breakMinutes: 60 }
		]);
		const [lt] = await db
			.insert(leaveTypes)
			.values({ establishmentId: est, code: 'VL', name: 'Vacation leave' })
			.returning({ id: leaveTypes.id });
		await db.insert(leaveRequests).values([
			{ establishmentId: est, employeeId: cy, leaveTypeId: lt!.id, startDate: '2026-06-09', endDate: '2026-06-11', days: 3, paid: true, status: 'approved' },
			// Waiting for Main HR: counted under "with Main HR", not as leave.
			{ establishmentId: est, employeeId: ana, leaveTypeId: lt!.id, startDate: '2026-06-20', endDate: '2026-06-20', days: 1, paid: true, status: 'submitted' }
		]);
	});

	afterAll(async () => {
		for (const id of noticeIds) await db.delete(announcements).where(eq(announcements.id, id));
		await cleanupTestEstablishments([est, other]);
	});

	it("counts today's roster and keeps a person on leave out of 'working'", async () => {
		const d = await D.getDashboard(est, tag, today);
		expect(d.staffCount).toBe(3);
		expect(d.roster).toEqual({ working: 1, rest: 1, onLeave: 1, unscheduled: 0 });
		expect(d.week.find((w) => w.isToday)?.working).toBe(1); // Cy is rostered but on leave
	});

	it('lists who is on leave and what is waiting on Main HR', async () => {
		const d = await D.getDashboard(est, tag, today);
		expect(d.onLeave).toHaveLength(1);
		expect(d.onLeave[0]).toMatchObject({ leaveType: 'Vacation leave', today: true });
		expect(d.attention.find((a) => a.key === 'waiting-hr')).toMatchObject({ tone: 'wait' });
		expect(d.attention.find((a) => a.key === 'next-week')).toBeDefined(); // nothing rostered next week
	});

	it('shows an announcement only to the establishments it is addressed to, until it expires', async () => {
		const everyone = await A.createAnnouncement(
			org,
			{ title: `All ${tag}`, body: 'Hello', establishmentIds: [], pinned: true, expiresOn: null },
			null
		);
		const justA = await A.createAnnouncement(
			org,
			{ title: `A only ${tag}`, body: 'Just A', establishmentIds: [est], pinned: false, expiresOn: '2026-06-12' },
			null
		);
		noticeIds.push(everyone.id, justA.id);

		const titlesA = (await A.announcementsFor(org, est, today)).map((n) => n.title);
		const titlesB = (await A.announcementsFor(org, other, today)).map((n) => n.title);
		expect(titlesA).toEqual(expect.arrayContaining([`All ${tag}`, `A only ${tag}`]));
		expect(titlesB).toContain(`All ${tag}`);
		expect(titlesB).not.toContain(`A only ${tag}`);
		expect(titlesA.indexOf(`All ${tag}`)).toBeLessThan(titlesA.indexOf(`A only ${tag}`)); // pinned first

		const later = (await A.announcementsFor(org, est, '2026-06-13')).map((n) => n.title);
		expect(later).not.toContain(`A only ${tag}`);

		await A.setAnnouncementStatus(org, everyone.id, 'archived');
		expect((await A.announcementsFor(org, est, today)).map((n) => n.title)).not.toContain(`All ${tag}`);
	});
});
