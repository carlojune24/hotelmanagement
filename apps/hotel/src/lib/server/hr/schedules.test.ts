import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';

/**
 * Live-DB tests: they create two throwaway hotels (with employees) under a random slug,
 * exercise the roster writes against them, and delete only what they created. They never
 * read or modify any other hotel's rows. Skipped when no DATABASE_URL is configured.
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

describe.skipIf(!hasDb)('roster writes (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const { dtrEntries, employees, hotels, schedules } = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { ScheduleError, applyShiftToCells, clearCells, copyWeek, listSchedules, restoreCells } =
		await import('./schedules');
	const {
		ShiftTemplateError,
		addStarterTemplates,
		createShiftTemplate,
		deleteShiftTemplate,
		listShiftTemplates,
		updateShiftTemplate
	} = await import('./shift-templates');

	const tag = `rostertest-${Math.random().toString(36).slice(2, 10)}`;
	let hotelA = '';
	let hotelB = '';
	let ann = '';
	let ben = '';
	let outsider = ''; // belongs to hotel B

	const MORNING = { isRestDay: false, startTime: '07:00', endTime: '15:00', breakMinutes: 60 };
	const REST = { isRestDay: true, startTime: null, endTime: null, breakMinutes: 0 };

	async function mkHotel(suffix: string) {
		const [h] = await db
			.insert(hotels)
			.values({ slug: `${tag}-${suffix}`, name: `Roster test ${suffix}`, orgRef: mintRef('org') })
			.returning({ id: hotels.id });
		return h!.id;
	}
	async function mkEmployee(hotelId: string, no: string, first: string) {
		const [e] = await db
			.insert(employees)
			.values({
				hotelId,
				personRef: mintRef('person'),
				employeeNo: no,
				firstName: first,
				lastName: 'Test',
				birthdate: '1990-01-01',
				sex: 'female',
				hiredOn: '2024-01-01',
				employmentType: 'regular',
				position: 'Tester',
				payBasis: 'monthly',
				baseRateCentavos: 1_000_000
			})
			.returning({ id: employees.id });
		return e!.id;
	}

	beforeAll(async () => {
		hotelA = await mkHotel('a');
		hotelB = await mkHotel('b');
		ann = await mkEmployee(hotelA, 'A1', 'Ann');
		ben = await mkEmployee(hotelA, 'A2', 'Ben');
		outsider = await mkEmployee(hotelB, 'B1', 'Out');
	});

	afterAll(async () => {
		// Hotels cascade to employees, schedules, dtr entries and shift templates.
		await db.delete(hotels).where(inArray(hotels.id, [hotelA, hotelB].filter(Boolean)));
	});

	const rows = (hotelId: string, from: string, to: string) => listSchedules(hotelId, from, to);

	it('paints a shift onto many cells, idempotently, returning the previous state', async () => {
		const cells = [
			{ employeeId: ann, date: '2026-09-28' },
			{ employeeId: ann, date: '2026-09-29' },
			{ employeeId: ben, date: '2026-09-28' }
		];
		const first = await applyShiftToCells(hotelA, cells, MORNING);
		expect(first.applied).toBe(3);
		expect(first.previous.every((p) => p.shift === null)).toBe(true);

		const again = await applyShiftToCells(hotelA, cells, MORNING);
		expect(again.applied).toBe(3);
		expect(again.previous.every((p) => p.shift?.startTime === '07:00')).toBe(true);

		const week = await rows(hotelA, '2026-09-28', '2026-10-04');
		expect(week).toHaveLength(3); // the unique (employee, date) index held — no duplicates
		expect(week[0]).toMatchObject({ startTime: '07:00', endTime: '15:00', breakMinutes: 60 });
	});

	it('ignores duplicate cells in one request', async () => {
		const r = await applyShiftToCells(
			hotelA,
			[
				{ employeeId: ben, date: '2026-09-30' },
				{ employeeId: ben, date: '2026-09-30' }
			],
			REST
		);
		expect(r.applied).toBe(1);
	});

	it("refuses another hotel's employee and writes nothing", async () => {
		await expect(
			applyShiftToCells(hotelA, [{ employeeId: outsider, date: '2026-10-01' }], MORNING)
		).rejects.toBeInstanceOf(ScheduleError);
		expect(await rows(hotelB, '2026-09-28', '2026-10-04')).toHaveLength(0);
		expect(await rows(hotelA, '2026-10-01', '2026-10-01')).toHaveLength(0);
	});

	it('is atomic: one bad employee in a batch rolls back the whole batch', async () => {
		await expect(
			applyShiftToCells(
				hotelA,
				[
					{ employeeId: ann, date: '2026-10-02' },
					{ employeeId: outsider, date: '2026-10-02' }
				],
				MORNING
			)
		).rejects.toBeInstanceOf(ScheduleError);
		expect(await rows(hotelA, '2026-10-02', '2026-10-02')).toHaveLength(0);
	});

	it('rejects a working shift with equal or missing times', async () => {
		const { cellShiftSchema } = await import('./schedules');
		expect(
			cellShiftSchema.safeParse({ isRestDay: false, startTime: '07:00', endTime: '07:00' }).success
		).toBe(false);
		expect(cellShiftSchema.safeParse({ isRestDay: false }).success).toBe(false);
		expect(cellShiftSchema.safeParse({ isRestDay: true }).success).toBe(true);
	});

	it('clears cells, reports what it removed, and undo restores them exactly', async () => {
		const cells = [
			{ employeeId: ann, date: '2026-09-28' },
			{ employeeId: ann, date: '2026-10-03' } // already empty
		];
		const cleared = await clearCells(hotelA, cells);
		expect(cleared.cleared).toBe(1);
		expect(cleared.previous).toHaveLength(1);
		expect(await rows(hotelA, '2026-09-28', '2026-09-28')).toHaveLength(1); // ben's only

		await restoreCells(hotelA, cleared.previous);
		const back = await rows(hotelA, '2026-09-28', '2026-09-28');
		expect(back).toHaveLength(2);
		expect(back.find((r) => r.employeeId === ann)).toMatchObject({
			startTime: '07:00',
			breakMinutes: 60
		});
	});

	it('undo of an overwrite puts the old shift back, and undo of a fresh paint empties the cell', async () => {
		const night = { isRestDay: false, startTime: '22:00', endTime: '06:00', breakMinutes: 0 };
		const overwrite = await applyShiftToCells(
			hotelA,
			[{ employeeId: ann, date: '2026-09-29' }],
			night
		);
		expect(overwrite.previous[0]?.shift?.startTime).toBe('07:00');
		await restoreCells(hotelA, overwrite.previous);
		expect(
			(await rows(hotelA, '2026-09-29', '2026-09-29')).find((r) => r.employeeId === ann)?.startTime
		).toBe('07:00');

		const fresh = await applyShiftToCells(hotelA, [{ employeeId: ann, date: '2026-10-04' }], night);
		expect(fresh.previous[0]?.shift).toBeNull();
		await restoreCells(hotelA, fresh.previous);
		expect(await rows(hotelA, '2026-10-04', '2026-10-04')).toHaveLength(0);
	});

	it('clearing a scheduled day leaves its DTR entry, merely unpaired', async () => {
		const [sched] = await applyShiftToCells(
			hotelA,
			[{ employeeId: ben, date: '2026-10-05' }],
			MORNING
		).then(() =>
			db
				.select({ id: schedules.id })
				.from(schedules)
				.where(and(eq(schedules.employeeId, ben), eq(schedules.date, '2026-10-05')))
		);
		const [dtr] = await db
			.insert(dtrEntries)
			.values({ hotelId: hotelA, employeeId: ben, scheduleId: sched!.id, date: '2026-10-05' })
			.returning({ id: dtrEntries.id });

		await clearCells(hotelA, [{ employeeId: ben, date: '2026-10-05' }]);

		const [after] = await db.select().from(dtrEntries).where(eq(dtrEntries.id, dtr!.id));
		expect(after).toBeDefined();
		expect(after?.scheduleId).toBeNull();
	});

	describe('copyWeek', () => {
		it('copies onto the next week, preserving the day of week', async () => {
			// Week of 2026-09-28 has: ann Mon/Tue, ben Mon/Wed(rest, from the dedupe test).
			const r = await copyWeek(hotelA, '2026-09-28', '2026-10-12', false);
			expect(r.copied).toBe(4);
			expect(r.skipped).toBe(0);
			const next = await rows(hotelA, '2026-10-12', '2026-10-18');
			expect(next.map((x) => x.date).sort()).toEqual([
				'2026-10-12',
				'2026-10-12',
				'2026-10-13',
				'2026-10-14'
			]);
		});

		it('leaves occupied target cells alone by default, replaces them with overwrite', async () => {
			const night = { isRestDay: false, startTime: '22:00', endTime: '06:00', breakMinutes: 0 };
			await applyShiftToCells(hotelA, [{ employeeId: ann, date: '2026-10-19' }], night);

			const keep = await copyWeek(hotelA, '2026-09-28', '2026-10-19', false);
			expect(keep.skipped).toBe(1);
			expect(keep.copied).toBe(3);
			const annMon = (await rows(hotelA, '2026-10-19', '2026-10-19')).find(
				(x) => x.employeeId === ann
			);
			expect(annMon?.startTime).toBe('22:00');

			const replace = await copyWeek(hotelA, '2026-09-28', '2026-10-19', true);
			expect(replace.skipped).toBe(0);
			const annMon2 = (await rows(hotelA, '2026-10-19', '2026-10-19')).find(
				(x) => x.employeeId === ann
			);
			expect(annMon2?.startTime).toBe('07:00');
		});

		it('undo of a copy restores the target week to how it was', async () => {
			const before = await rows(hotelA, '2026-10-26', '2026-11-01');
			expect(before).toHaveLength(0);
			const r = await copyWeek(hotelA, '2026-09-28', '2026-10-26', false);
			expect(r.copied).toBeGreaterThan(0);
			await restoreCells(hotelA, r.previous);
			expect(await rows(hotelA, '2026-10-26', '2026-11-01')).toHaveLength(0);
		});

		it('never copies another hotel’s shifts, and refuses copying a week onto itself', async () => {
			await applyShiftToCells(hotelB, [{ employeeId: outsider, date: '2026-09-28' }], MORNING);
			await copyWeek(hotelA, '2026-09-28', '2026-11-09', false);
			const copied = await rows(hotelA, '2026-11-09', '2026-11-15');
			expect(copied.every((x) => x.employeeId !== outsider)).toBe(true);
			await expect(copyWeek(hotelA, '2026-09-28', '2026-09-28', false)).rejects.toBeInstanceOf(
				ScheduleError
			);
		});
	});

	describe('shift templates', () => {
		it('creates, lists in order, updates and soft-deletes', async () => {
			const a = await createShiftTemplate(hotelA, {
				name: 'Early',
				isRestDay: false,
				startTime: '06:00',
				endTime: '14:00',
				breakMinutes: 30,
				tag: 'ok'
			});
			const b = await createShiftTemplate(hotelA, {
				name: 'Off',
				isRestDay: true,
				breakMinutes: 0,
				tag: 'neutral'
			});
			const list = await listShiftTemplates(hotelA);
			expect(list.map((t) => t.name)).toEqual(['Early', 'Off']);
			expect(list[0]).toMatchObject({ startTime: '06:00', endTime: '14:00', tag: 'ok' });
			expect(list[1]).toMatchObject({ isRestDay: true, startTime: null, endTime: null });

			await updateShiftTemplate(hotelA, a!.id, {
				name: 'Early bird',
				isRestDay: false,
				startTime: '05:00',
				endTime: '13:00',
				breakMinutes: 30,
				tag: 'ok'
			});
			expect((await listShiftTemplates(hotelA))[0]).toMatchObject({
				name: 'Early bird',
				startTime: '05:00'
			});

			await deleteShiftTemplate(hotelA, b!.id);
			expect((await listShiftTemplates(hotelA)).map((t) => t.name)).toEqual(['Early bird']);
		});

		it('rejects a duplicate name, but a deleted name can be reused', async () => {
			await expect(
				createShiftTemplate(hotelA, {
					name: 'Early bird',
					isRestDay: false,
					startTime: '01:00',
					endTime: '02:00',
					breakMinutes: 0,
					tag: 'neutral'
				})
			).rejects.toBeInstanceOf(ShiftTemplateError);
			const [off] = await listShiftTemplates(hotelA).then((l) =>
				l.filter((t) => t.name === 'Early bird')
			);
			await deleteShiftTemplate(hotelA, off!.id);
			await expect(
				createShiftTemplate(hotelA, {
					name: 'Early bird',
					isRestDay: false,
					startTime: '01:00',
					endTime: '02:00',
					breakMinutes: 0,
					tag: 'neutral'
				})
			).resolves.toBeDefined();
		});

		it('is tenant-scoped: another hotel cannot edit or delete a template', async () => {
			const [mine] = await listShiftTemplates(hotelA);
			await expect(
				updateShiftTemplate(hotelB, mine!.id, {
					name: 'Hijack',
					isRestDay: true,
					breakMinutes: 0,
					tag: 'neutral'
				})
			).rejects.toBeInstanceOf(ShiftTemplateError);
			await expect(deleteShiftTemplate(hotelB, mine!.id)).rejects.toBeInstanceOf(
				ShiftTemplateError
			);
			expect(await listShiftTemplates(hotelB)).toHaveLength(0);
		});

		it('adds the starter set once, skipping names already present', async () => {
			const added = await addStarterTemplates(hotelB);
			expect(added).toBe(4);
			expect(await addStarterTemplates(hotelB)).toBe(0);
			const names = (await listShiftTemplates(hotelB)).map((t) => t.name);
			expect(names).toEqual(['Morning', 'Afternoon', 'Night', 'Rest day']);
		});

		it('editing a template does not rewrite rosters already built from it', async () => {
			await applyShiftToCells(hotelB, [{ employeeId: outsider, date: '2026-12-01' }], MORNING);
			const [morning] = await listShiftTemplates(hotelB).then((l) =>
				l.filter((t) => t.name === 'Morning')
			);
			await updateShiftTemplate(hotelB, morning!.id, {
				name: 'Morning',
				isRestDay: false,
				startTime: '05:00',
				endTime: '13:00',
				breakMinutes: 0,
				tag: 'neutral'
			});
			const row = (await rows(hotelB, '2026-12-01', '2026-12-01'))[0];
			expect(row).toMatchObject({ startTime: '07:00', endTime: '15:00' });
		});
	});
});
