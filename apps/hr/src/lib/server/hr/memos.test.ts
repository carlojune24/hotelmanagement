import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestOrg, createTestOrg } from './test-helpers';

const hasDb = Boolean(process.env.DATABASE_URL) || (await hasEnvFile());
async function hasEnvFile(): Promise<boolean> {
	try {
		const { env } = await import('$env/dynamic/private');
		return Boolean(env.DATABASE_URL);
	} catch {
		return false;
	}
}

describe.skipIf(!hasDb)('holidays and memos belong to Main HR (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const { establishments } = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const C = await import('./calendar');

	let org = '';
	const ests: string[] = [];
	const form = (date: string, name: string, over: Partial<import('./calendar').CalendarFormInput> = {}) => ({
		date,
		name,
		kind: 'memo' as const,
		creditHours: 4,
		waiveLateness: true,
		scope: 'company' as const,
		establishmentIds: [] as string[],
		...over
	});

	beforeAll(async () => {
		org = await createTestOrg();
		for (const label of ['A', 'B', 'C']) {
			const [e] = await db
				.insert(establishments)
				.values({
					organizationId: org,
					kind: 'business',
					slug: `cal-${label}-${Math.random().toString(36).slice(2, 8)}`,
					name: `Calendar test ${label}`,
					orgRef: mintRef('org')
				})
				.returning({ id: establishments.id });
			ests.push(e!.id);
		}
	});
	afterAll(async () => {
		await db.delete(establishments).where((await import('drizzle-orm')).inArray(establishments.id, ests));
		await cleanupTestOrg(org);
	});

	const [A, B, Cc] = [0, 1, 2] as const;
	const names = async (est: string, from = '2099-03-01', to = '2099-03-31') =>
		(await C.listCalendar(est, from, to)).map((d) => d.name);

	it('a company-wide day reaches every establishment at once, including one added later', async () => {
		await C.saveCalendarDay(org, form('2099-03-10', 'Foundation Day'));
		expect(await names(ests[A]!)).toEqual(['Foundation Day']);
		expect(await names(ests[B]!)).toEqual(['Foundation Day']);

		const [late] = await db
			.insert(establishments)
			.values({ organizationId: org, kind: 'business', slug: `cal-late-${Math.random().toString(36).slice(2, 8)}`, name: 'Added later', orgRef: mintRef('org') })
			.returning({ id: establishments.id });
		ests.push(late!.id);
		expect(await names(late!.id)).toEqual(['Foundation Day']);
	});

	it('a selected day reaches only the establishments chosen', async () => {
		await C.saveCalendarDay(org, form('2099-03-12', 'Fiesta', { scope: 'selected', establishmentIds: [ests[A]!, ests[B]!] }));
		expect(await names(ests[A]!, '2099-03-12', '2099-03-12')).toEqual(['Fiesta']);
		expect(await names(ests[B]!, '2099-03-12', '2099-03-12')).toEqual(['Fiesta']);
		expect(await names(ests[Cc]!, '2099-03-12', '2099-03-12')).toEqual([]);
	});

	it('an entry made for an establishment wins over the company one on the same date', async () => {
		await C.saveCalendarDay(org, form('2099-03-10', 'Early release', { scope: 'selected', establishmentIds: [ests[B]!], creditHours: 2 }));
		const a = (await C.listCalendar(ests[A]!, '2099-03-10', '2099-03-10'))[0]!;
		const b = (await C.listCalendar(ests[B]!, '2099-03-10', '2099-03-10'))[0]!;
		expect(a.name).toBe('Foundation Day');
		expect(b).toMatchObject({ name: 'Early release', creditMinutes: 120 });
	});

	it('refuses a second company-wide entry, or a second one for the same establishment, on a date', async () => {
		await expect(C.saveCalendarDay(org, form('2099-03-10', 'Again'))).rejects.toThrow(/whole company already/);
		await expect(
			C.saveCalendarDay(org, form('2099-03-12', 'Clash', { scope: 'selected', establishmentIds: [ests[B]!, ests[Cc]!] }))
		).rejects.toThrow(/already has an entry/);
	});

	it('needs at least one establishment when it is not company-wide, and only the company\'s own', async () => {
		const parsed = C.calendarFormSchema.safeParse({ ...form('2099-03-14', 'None'), scope: 'selected', establishmentIds: [] });
		expect(parsed.success).toBe(false);
		await expect(
			C.saveCalendarDay(org, form('2099-03-14', 'Foreign', { scope: 'selected', establishmentIds: ['00000000-0000-4000-8000-000000000000'] }))
		).rejects.toThrow(/not part of this company/);
	});

	it('editing switches scope and removing deletes the day', async () => {
		const day = (await C.listCompanyCalendar(org, '2099-03-12', '2099-03-12'))[0]!;
		expect(day.establishmentIds.sort()).toEqual([ests[A]!, ests[B]!].sort());
		await C.saveCalendarDay(org, form('2099-03-12', 'Fiesta', { scope: 'selected', establishmentIds: [ests[Cc]!] }), day.id);
		expect(await names(ests[A]!, '2099-03-12', '2099-03-12')).toEqual([]);
		expect(await names(ests[Cc]!, '2099-03-12', '2099-03-12')).toEqual(['Fiesta']);
		await C.deleteCalendarDay(org, day.id);
		expect(await names(ests[Cc]!, '2099-03-12', '2099-03-12')).toEqual([]);
	});
});
