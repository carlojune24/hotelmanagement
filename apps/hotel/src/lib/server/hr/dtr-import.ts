import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import {
	biometricImportTemplates,
	biometricPunches,
	biometricUploads,
	dtrEntries,
	employees,
	hotels,
	schedules
} from '$lib/server/db/schema/index';
import { wallTimeToUtcMs } from '$lib/server/cancellation';
import { businessDateFor } from '$lib/server/finance/shared';
import {
	DATE_FORMATS,
	clusterPunches,
	computeMetrics,
	nightWindowParts,
	normalizeEnrollId,
	parseWallDateTime,
	recordRemarks,
	type DtrFlag,
	type DtrMetrics,
	type ScheduleInput
} from '$lib/hr-import';
import { addDays, monthBounds, netShiftMinutes, timeToMinutes } from '$lib/roster';
import { listCalendar } from '$lib/server/hr/calendar';
import { listLeaveDays, type LeaveDay } from '$lib/server/hr/leave';

export class DtrImportError extends Error {}

// ---------------------------------------------------------------------------
// Templates (saved column mappings)
// ---------------------------------------------------------------------------

export const mappingSchema = z.object({
	idColumn: z.coerce.number().int().min(0).max(200),
	datetimeColumn: z.coerce.number().int().min(0).max(200),
	hasHeader: z.boolean().default(true),
	dateFormat: z.enum(DATE_FORMATS).default('auto')
});
export type ImportMapping = z.infer<typeof mappingSchema>;

export const templateFormSchema = mappingSchema
	.extend({ name: z.string().trim().min(1, 'Give the template a name.').max(60) })
	.refine((v) => v.idColumn !== v.datetimeColumn, {
		message: 'Pick two different columns.',
		path: ['datetimeColumn']
	});

export async function listImportTemplates(hotelId: string) {
	return db
		.select({
			id: biometricImportTemplates.id,
			name: biometricImportTemplates.name,
			idColumn: biometricImportTemplates.idColumn,
			datetimeColumn: biometricImportTemplates.datetimeColumn,
			hasHeader: biometricImportTemplates.hasHeader,
			dateFormat: biometricImportTemplates.dateFormat
		})
		.from(biometricImportTemplates)
		.where(and(eq(biometricImportTemplates.hotelId, hotelId), isNull(biometricImportTemplates.deletedAt)))
		.orderBy(asc(biometricImportTemplates.name));
}

export async function getImportTemplate(hotelId: string, id: string) {
	const [row] = await db
		.select()
		.from(biometricImportTemplates)
		.where(
			and(
				eq(biometricImportTemplates.hotelId, hotelId),
				eq(biometricImportTemplates.id, id),
				isNull(biometricImportTemplates.deletedAt)
			)
		);
	return row ?? null;
}

/** Saving under an existing name updates that template's mapping rather than failing. */
export async function createImportTemplate(hotelId: string, input: z.infer<typeof templateFormSchema>) {
	const [dupe] = await db
		.select({ id: biometricImportTemplates.id })
		.from(biometricImportTemplates)
		.where(
			and(
				eq(biometricImportTemplates.hotelId, hotelId),
				eq(biometricImportTemplates.name, input.name),
				isNull(biometricImportTemplates.deletedAt)
			)
		);
	if (dupe) {
		const [row] = await db
			.update(biometricImportTemplates)
			.set({ ...input, updatedAt: new Date() })
			.where(eq(biometricImportTemplates.id, dupe.id))
			.returning();
		return row!;
	}
	const [row] = await db
		.insert(biometricImportTemplates)
		.values({ hotelId, ...input })
		.returning();
	return row!;
}

export async function deleteImportTemplate(hotelId: string, id: string) {
	await db
		.update(biometricImportTemplates)
		.set({ deletedAt: new Date() })
		.where(and(eq(biometricImportTemplates.hotelId, hotelId), eq(biometricImportTemplates.id, id)));
}

// ---------------------------------------------------------------------------
// Raw punches — import only stores, nothing is interpreted yet
// ---------------------------------------------------------------------------

export type StoreResult = {
	total: number;
	inserted: number;
	duplicates: number;
	badRows: number;
	badRowSamples: string[];
	/** `YYYY-MM` months (hotel time) that the file's punches fall in. */
	months: string[];
	/** IDs in the file that no employee has as a Biometric ID yet. */
	unmatched: Array<{ enrollId: string; punches: number }>;
};

async function hotelTimezone(hotelId: string): Promise<string> {
	const [hotel] = await db
		.select({ timezone: hotels.timezone })
		.from(hotels)
		.where(eq(hotels.id, hotelId));
	return hotel?.timezone ?? 'Asia/Manila';
}

/** Every employee's normalised Biometric ID → employee, for matching punches. */
async function employeesByEnrollKey(hotelId: string) {
	const emps = await db
		.select({
			id: employees.id,
			firstName: employees.firstName,
			lastName: employees.lastName,
			enroll: employees.biometricEnrollId
		})
		.from(employees)
		.where(and(eq(employees.hotelId, hotelId), isNull(employees.deletedAt)));
	const byKey = new Map<string, (typeof emps)[number]>();
	for (const e of emps) if (e.enroll) byKey.set(normalizeEnrollId(e.enroll), e);
	return { emps, byKey };
}

/** Reads the file with the mapping and appends every readable punch. Re-importing a file adds nothing twice. */
export async function storePunches(
	hotelId: string,
	rows: string[][],
	mapping: ImportMapping,
	fileName: string,
	period: string,
	userId: string | null
): Promise<StoreResult> {
	const tz = await hotelTimezone(hotelId);
	const dateOf = new Intl.DateTimeFormat('en-CA', { timeZone: tz });
	const dataRows = mapping.hasHeader ? rows.slice(1) : rows;

	const seen = new Set<string>();
	const punches: Array<{ enrollId: string; enrollKey: string; ms: number }> = [];
	const months = new Set<string>();
	let badRows = 0;
	const badRowSamples: string[] = [];
	for (const row of dataRows) {
		const rawId = row[mapping.idColumn] ?? '';
		const wall = parseWallDateTime(row[mapping.datetimeColumn] ?? '', mapping.dateFormat);
		if (!rawId || !wall) {
			badRows++;
			if (badRowSamples.length < 3) badRowSamples.push(row.join(' | ').slice(0, 120));
			continue;
		}
		const enrollKey = normalizeEnrollId(rawId);
		const ms = wallTimeToUtcMs(wall.date, wall.time, tz);
		const dedupe = `${enrollKey}|${ms}`;
		if (seen.has(dedupe)) continue;
		seen.add(dedupe);
		punches.push({ enrollId: rawId, enrollKey, ms });
		months.add(dateOf.format(new Date(ms)).slice(0, 7));
	}
	if (punches.length === 0) {
		throw new DtrImportError(
			badRows > 0
				? `No date/time could be read from the chosen column (e.g. ${badRowSamples[0] ?? ''}). Check the mapping and date format.`
				: 'That file has no punches.'
		);
	}

	let inserted = 0;
	const CHUNK = 1000;
	await db.transaction(async (tx) => {
		const [upload] = await tx
			.insert(biometricUploads)
			.values({
				hotelId,
				fileName: fileName.slice(0, 200),
				period,
				punchCount: punches.length,
				uploadedByUserId: userId
			})
			.returning({ id: biometricUploads.id });
		for (let i = 0; i < punches.length; i += CHUNK) {
			const res = await tx
				.insert(biometricPunches)
				.values(
					punches.slice(i, i + CHUNK).map((p) => ({
						hotelId,
						uploadId: upload!.id,
						enrollId: p.enrollId,
						enrollKey: p.enrollKey,
						punchedAt: new Date(p.ms),
						sourceFile: fileName.slice(0, 200),
						importedByUserId: userId
					}))
				)
				.onConflictDoNothing()
				.returning({ id: biometricPunches.id });
			inserted += res.length;
		}
		// A file that adds nothing new (already uploaded) leaves no empty file behind.
		if (inserted === 0) await tx.delete(biometricUploads).where(eq(biometricUploads.id, upload!.id));
		else
			await tx
				.update(biometricUploads)
				.set({ newCount: inserted })
				.where(eq(biometricUploads.id, upload!.id));
	});

	const { byKey } = await employeesByEnrollKey(hotelId);
	const unmatchedCounts = new Map<string, { enrollId: string; punches: number }>();
	for (const p of punches) {
		if (byKey.has(p.enrollKey)) continue;
		const u = unmatchedCounts.get(p.enrollKey) ?? { enrollId: p.enrollId, punches: 0 };
		u.punches++;
		unmatchedCounts.set(p.enrollKey, u);
	}

	return {
		total: punches.length,
		inserted,
		duplicates: punches.length - inserted,
		badRows,
		badRowSamples,
		months: [...months].sort(),
		unmatched: [...unmatchedCounts.values()].sort((a, b) => b.punches - a.punches)
	};
}

export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

function monthRange(tz: string, month: string) {
	const { start, end } = monthBounds(`${month}-01`);
	return {
		from: new Date(wallTimeToUtcMs(start, '00:00:00', tz)),
		to: new Date(wallTimeToUtcMs(addDays(end, 1), '00:00:00', tz))
	};
}

/** Files filed under a year-month, newest first. */
export async function listUploads(hotelId: string, month: string) {
	return db
		.select({
			id: biometricUploads.id,
			fileName: biometricUploads.fileName,
			punchCount: biometricUploads.punchCount,
			newCount: biometricUploads.newCount,
			createdAt: biometricUploads.createdAt
		})
		.from(biometricUploads)
		.where(and(eq(biometricUploads.hotelId, hotelId), eq(biometricUploads.period, month)))
		.orderBy(desc(biometricUploads.createdAt));
}

/** Every Biometric ID with punches in the month — matched to an employee or not — with its count. */
export async function listPunchIds(hotelId: string, month: string) {
	const tz = await hotelTimezone(hotelId);
	const { from, to } = monthRange(tz, month);
	const [rows, { byKey }] = await Promise.all([
		db
			.select({
				enrollKey: biometricPunches.enrollKey,
				enrollId: sql<string>`min(${biometricPunches.enrollId})`,
				punches: sql<number>`count(*)::int`
			})
			.from(biometricPunches)
			.where(
				and(
					eq(biometricPunches.hotelId, hotelId),
					gte(biometricPunches.punchedAt, from),
					lt(biometricPunches.punchedAt, to)
				)
			)
			.groupBy(biometricPunches.enrollKey),
		employeesByEnrollKey(hotelId)
	]);
	return rows
		.map((r) => {
			const emp = byKey.get(r.enrollKey);
			return {
				enrollKey: r.enrollKey,
				enrollId: r.enrollId,
				punches: r.punches,
				employeeName: emp ? `${emp.firstName} ${emp.lastName}` : null
			};
		})
		.sort((a, b) => a.enrollId.localeCompare(b.enrollId, undefined, { numeric: true }));
}

/** One ID's punches in the month, oldest first, each with the file it came from. */
export async function listPunchesForId(hotelId: string, month: string, enrollKey: string) {
	const tz = await hotelTimezone(hotelId);
	const { from, to } = monthRange(tz, month);
	const rows = await db
		.select({
			id: biometricPunches.id,
			punchedAt: biometricPunches.punchedAt,
			uploadId: biometricPunches.uploadId,
			source: biometricPunches.source,
			note: biometricPunches.note,
			fileName: biometricUploads.fileName,
			uploadedAt: biometricUploads.createdAt,
			legacyFile: biometricPunches.sourceFile
		})
		.from(biometricPunches)
		.leftJoin(biometricUploads, eq(biometricUploads.id, biometricPunches.uploadId))
		.where(
			and(
				eq(biometricPunches.hotelId, hotelId),
				eq(biometricPunches.enrollKey, enrollKey),
				gte(biometricPunches.punchedAt, from),
				lt(biometricPunches.punchedAt, to)
			)
		)
		.orderBy(asc(biometricPunches.punchedAt));
	return rows.map((r) => ({
		id: r.id,
		punchedAt: r.punchedAt.getTime(),
		uploadId: r.uploadId,
		source: r.source as 'file' | 'manual',
		note: r.note,
		fileName: r.fileName ?? r.legacyFile,
		uploadedAt: r.uploadedAt ? r.uploadedAt.getTime() : null
	}));
}

/** Deleting a file takes its punches with it; punches added by hand are never in a file. */
export async function removeUpload(hotelId: string, id: string) {
	const res = await db
		.delete(biometricUploads)
		.where(and(eq(biometricUploads.hotelId, hotelId), eq(biometricUploads.id, id)))
		.returning({ fileName: biometricUploads.fileName, punchCount: biometricUploads.punchCount });
	return res[0] ?? null;
}

export async function removePunch(hotelId: string, id: string) {
	await db
		.delete(biometricPunches)
		.where(and(eq(biometricPunches.hotelId, hotelId), eq(biometricPunches.id, id)));
}

export const addPunchSchema = z.object({
	enrollId: z.string().trim().min(1, 'Enter the Biometric ID.').max(40),
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the date.'),
	time: z.string().regex(/^\d{2}:\d{2}$/, 'Pick the time.'),
	note: z.string().trim().min(3, 'Say why the punch is being added.').max(300)
});

/** A punch added by hand, for someone proven present who forgot to use the biometric. */
export async function addManualPunch(
	hotelId: string,
	input: z.infer<typeof addPunchSchema>,
	userId: string | null
) {
	const tz = await hotelTimezone(hotelId);
	const ms = wallTimeToUtcMs(input.date, `${input.time}:00`, tz);
	if (!Number.isFinite(ms)) throw new DtrImportError('That date or time is not valid.');
	const inserted = await db
		.insert(biometricPunches)
		.values({
			hotelId,
			enrollId: input.enrollId,
			enrollKey: normalizeEnrollId(input.enrollId),
			punchedAt: new Date(ms),
			source: 'manual',
			note: input.note,
			addedByUserId: userId
		})
		.onConflictDoNothing()
		.returning({ id: biometricPunches.id });
	if (inserted.length === 0) throw new DtrImportError('That punch is already recorded.');
	return { id: inserted[0]!.id, ms };
}

// ---------------------------------------------------------------------------
// Generating a month's DTR from the stored punches
// ---------------------------------------------------------------------------

export type DtrAction = 'create' | 'update' | 'keep_manual';

export type GeneratedRecord = DtrMetrics & {
	employeeId: string;
	employeeName: string;
	enrollId: string;
	date: string;
	timeIn: number | null;
	timeOut: number | null;
	/** Split shifts only. */
	breakOut: number | null;
	breakIn: number | null;
	scheduleId: string | null;
	isAbsent: boolean;
	flags: DtrFlag[];
	/** At least one punch that day was added by hand. */
	manualPunch: boolean;
	/** Approved leave covering the day. */
	leave: LeaveDay | null;
	/** Holiday or memorandum on the day. */
	calendar: { id: string; name: string; kind: string; waiveLateness: boolean } | null;
	/** Paid-leave minutes counted inside `workedMinutes`. */
	leaveMinutes: number;
	action: DtrAction;
};

export type MonthDtr = {
	month: string;
	range: { start: string; end: string };
	punchCount: number;
	employeeCount: number;
	unmatched: Array<{ enrollId: string; punches: number }>;
	/** Everyone this run covered (with a Biometric ID), whether or not they have records. */
	scopeIds: string[];
	records: GeneratedRecord[];
};

const hhmmss = (m: number) =>
	`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;

/**
 * One month of DTR for everyone with a Biometric ID (or just `employeeId`), worked out from
 * the stored punches and the roster: in/out, late, undertime, and an Absent record for every
 * scheduled working day before today with no punches. Reads only; `saveMonthDtr` writes.
 * Overtime and leave are not handled yet.
 */
export async function computeMonthDtr(
	hotelId: string,
	month: string,
	employeeId?: string
): Promise<MonthDtr> {
	const tz = await hotelTimezone(hotelId);
	const range = monthBounds(`${month}-01`);
	const today = businessDateFor(tz);
	// A little slack either side so an overnight shift that crosses a month edge pairs correctly.
	const from = new Date(wallTimeToUtcMs(addDays(range.start, -1), '00:00:00', tz));
	const to = new Date(wallTimeToUtcMs(addDays(range.end, 2), '00:00:00', tz));

	const [punchRows, { emps, byKey }] = await Promise.all([
		db
			.select({
				enrollId: biometricPunches.enrollId,
				enrollKey: biometricPunches.enrollKey,
				punchedAt: biometricPunches.punchedAt,
				source: biometricPunches.source
			})
			.from(biometricPunches)
			.where(
				and(
					eq(biometricPunches.hotelId, hotelId),
					gte(biometricPunches.punchedAt, from),
					lt(biometricPunches.punchedAt, to)
				)
			),
		employeesByEnrollKey(hotelId)
	]);

	const inScope = emps.filter((e) => e.enroll && (!employeeId || e.id === employeeId));
	const scopeIds = inScope.map((e) => e.id);
	const dateOf = new Intl.DateTimeFormat('en-CA', { timeZone: tz });

	const manualMs = new Set<string>();
	const byEnroll = new Map<string, number[]>();
	const rawIds = new Map<string, string>();
	for (const p of punchRows) {
		rawIds.set(p.enrollKey, p.enrollId);
		const list = byEnroll.get(p.enrollKey) ?? [];
		list.push(p.punchedAt.getTime());
		if (p.source === 'manual') manualMs.add(`${p.enrollKey}|${p.punchedAt.getTime()}`);
		byEnroll.set(p.enrollKey, list);
	}

	const unmatched: MonthDtr['unmatched'] = [];
	const clustered: Array<{
		emp: (typeof emps)[number];
		enrollId: string;
		date: string;
		cluster: ReturnType<typeof clusterPunches>[number];
	}> = [];
	let punchCount = 0;
	for (const [key, instants] of byEnroll) {
		const emp = byKey.get(key);
		if (!emp) {
			const inMonth = instants.filter((ms) => {
				const d = dateOf.format(new Date(ms));
				return d >= range.start && d <= range.end;
			});
			if (!employeeId && inMonth.length > 0) {
				unmatched.push({ enrollId: rawIds.get(key) ?? key, punches: inMonth.length });
			}
			continue;
		}
		if (!scopeIds.includes(emp.id)) continue;
		const seenDates = new Set<string>();
		for (const cluster of clusterPunches(instants)) {
			const date = dateOf.format(new Date(cluster.inMs));
			if (date < range.start || date > range.end || seenDates.has(date)) continue;
			seenDates.add(date);
			punchCount += cluster.punchCount;
			clustered.push({ emp, enrollId: rawIds.get(key) ?? key, date, cluster });
		}
	}
	unmatched.sort((a, b) => b.punches - a.punches);

	const [schedRows, existing] =
		scopeIds.length === 0
			? [[], []]
			: await Promise.all([
					db
						.select()
						.from(schedules)
						.where(
							and(
								eq(schedules.hotelId, hotelId),
								isNull(schedules.deletedAt),
								inArray(schedules.employeeId, scopeIds),
								gte(schedules.date, range.start),
								lte(schedules.date, range.end)
							)
						),
					db
						.select({
							employeeId: dtrEntries.employeeId,
							date: dtrEntries.date,
							source: dtrEntries.source
						})
						.from(dtrEntries)
						.where(
							and(
								eq(dtrEntries.hotelId, hotelId),
								isNull(dtrEntries.deletedAt),
								inArray(dtrEntries.employeeId, scopeIds),
								gte(dtrEntries.date, range.start),
								lte(dtrEntries.date, range.end)
							)
						)
				]);
	const schedByKey = new Map(schedRows.map((s) => [`${s.employeeId}|${s.date}`, s]));
	const existingByKey = new Map(existing.map((e) => [`${e.employeeId}|${e.date}`, e]));
	const actionFor = (key: string): DtrAction => {
		const prior = existingByKey.get(key);
		return !prior ? 'create' : prior.source === 'manual' ? 'keep_manual' : 'update';
	};

	const records: GeneratedRecord[] = clustered.map(({ emp, enrollId, date, cluster }) => {
		const key = `${emp.id}|${date}`;
		const sched = schedByKey.get(key) ?? null;

		let scheduleInput: ScheduleInput | null = null;
		if (sched) {
			const s = timeToMinutes(sched.startTime?.slice(0, 5));
			const e = timeToMinutes(sched.endTime?.slice(0, 5));
			const startMs =
				!sched.isRestDay && s !== null ? wallTimeToUtcMs(date, sched.startTime!, tz) : null;
			let endMs: number | null = null;
			if (!sched.isRestDay && s !== null && e !== null) {
				endMs = wallTimeToUtcMs(e <= s ? addDays(date, 1) : date, sched.endTime!, tz);
			}
			const bs = timeToMinutes(sched.breakStart?.slice(0, 5));
			const be = timeToMinutes(sched.breakEnd?.slice(0, 5));
			const split = !sched.isRestDay && bs !== null && be !== null;
			scheduleInput = {
				isRestDay: sched.isRestDay,
				startMs,
				endMs,
				breakMinutes: sched.breakMinutes,
				breakStartMs: split ? wallTimeToUtcMs(date, sched.breakStart!, tz) : null,
				breakEndMs: split ? wallTimeToUtcMs(date, sched.breakEnd!, tz) : null
			};
		}

		const win = nightWindowParts(
			(sched?.nightDiffWindow as { start: string; end: string } | null | undefined) ?? null
		);
		const nightWindows: Array<[number, number]> = [-1, 0, 1].map((offset) => {
			const day = addDays(date, offset);
			return [
				wallTimeToUtcMs(day, hhmmss(win.start), tz),
				wallTimeToUtcMs(win.overnight ? addDays(day, 1) : day, hhmmss(win.end), tz)
			];
		});

		const { metrics, flags, slots } = computeMetrics(cluster, scheduleInput, nightWindows);
		return {
			employeeId: emp.id,
			employeeName: `${emp.firstName} ${emp.lastName}`,
			enrollId,
			date,
			timeIn: slots?.inMs ?? cluster.inMs,
			timeOut: slots ? slots.outMs : cluster.outMs,
			breakOut: slots?.breakOutMs ?? null,
			breakIn: slots?.breakInMs ?? null,
			scheduleId: sched?.id ?? null,
			isAbsent: false,
			flags,
			manualPunch: cluster.punches.some((ms) => manualMs.has(`${normalizeEnrollId(enrollId)}|${ms}`)),
			leave: null,
			calendar: null,
			leaveMinutes: 0,
			action: actionFor(key),
			...metrics
		};
	});

	// Leave, holidays and memos: they cover the schedule, so they win over "absent" and, for a
	// whole-day leave, over any punches that day. A staff-entered DTR row still wins over all.
	const [leaveMap, calendarRows] = await Promise.all([
		scopeIds.length > 0
			? listLeaveDays(hotelId, range.start, range.end, scopeIds)
			: Promise.resolve(new Map<string, LeaveDay>()),
		listCalendar(hotelId, range.start, range.end)
	]);
	const calByDate = new Map(calendarRows.map((c) => [c.date, c]));
	const calInfo = (date: string): GeneratedRecord['calendar'] => {
		const c = calByDate.get(date);
		return c ? { id: c.id, name: c.name, kind: c.kind, waiveLateness: c.waiveLateness } : null;
	};
	const scheduledMinutes = (sched: (typeof schedRows)[number] | undefined) =>
		sched
			? netShiftMinutes({
					isRestDay: sched.isRestDay,
					startTime: sched.startTime?.slice(0, 5),
					endTime: sched.endTime?.slice(0, 5),
					breakMinutes: sched.breakMinutes
				})
			: 0;

	for (let i = 0; i < records.length; i++) {
		const r = records[i]!;
		const key = `${r.employeeId}|${r.date}`;
		const sm = scheduledMinutes(schedByKey.get(key));
		const lv = leaveMap.get(key) ?? null;
		const cal = calByDate.get(r.date) ?? null;
		if (lv && !lv.halfDay) {
			records[i] = {
				...r,
				timeIn: null,
				timeOut: null,
				breakOut: null,
				breakIn: null,
				flags: [],
				manualPunch: false,
				leave: lv,
				calendar: null,
				workedMinutes: lv.paid ? sm : 0,
				leaveMinutes: lv.paid ? sm : 0,
				otMinutes: 0,
				nightDiffMinutes: 0,
				tardinessMinutes: 0,
				undertimeMinutes: 0
			};
		} else if (lv) {
			const half = Math.round(sm / 2);
			r.leave = lv;
			r.undertimeMinutes = Math.max(0, r.undertimeMinutes - half);
			if (lv.paid) {
				r.workedMinutes = Math.min(sm, r.workedMinutes + half);
				r.leaveMinutes = half;
			}
		} else if (cal) {
			const credit = cal.creditMinutes ?? sm;
			r.workedMinutes = Math.max(r.workedMinutes, credit);
			if (cal.waiveLateness) {
				r.tardinessMinutes = 0;
				r.undertimeMinutes = 0;
			}
			r.calendar = calInfo(r.date);
		}
	}

	// Days with no punches: leave or a holiday/memo credits the day; otherwise a past working
	// day is an absence.
	const punchedDays = new Set(clustered.map((c) => `${c.emp.id}|${c.date}`));
	for (const emp of inScope) {
		for (const sched of schedRows) {
			if (sched.employeeId !== emp.id || sched.isRestDay || !sched.startTime) continue;
			const key = `${emp.id}|${sched.date}`;
			if (punchedDays.has(key)) continue;
			const lv = leaveMap.get(key) ?? null;
			const cal = calByDate.get(sched.date) ?? null;
			if (!lv && !cal && sched.date >= today) continue;
			const action = actionFor(key);
			// A manual entry for the day already speaks for it; nothing to add or show.
			if (action === 'keep_manual') continue;
			const sm = scheduledMinutes(sched);
			let credit = 0;
			let leaveMinutes = 0;
			if (lv) {
				const covered = lv.halfDay ? Math.round(sm / 2) : sm;
				credit = lv.paid ? covered : 0;
				leaveMinutes = credit;
			} else if (cal) {
				credit = cal.creditMinutes ?? sm;
			}
			records.push({
				employeeId: emp.id,
				employeeName: `${emp.firstName} ${emp.lastName}`,
				enrollId: emp.enroll!,
				date: sched.date,
				timeIn: null,
				timeOut: null,
				breakOut: null,
				breakIn: null,
				scheduleId: sched.id,
				isAbsent: !lv && !cal,
				flags: [],
				manualPunch: false,
				leave: lv,
				calendar: lv ? null : calInfo(sched.date),
				leaveMinutes,
				action,
				workedMinutes: credit,
				otMinutes: 0,
				nightDiffMinutes: 0,
				tardinessMinutes: 0,
				undertimeMinutes: 0
			});
		}
	}
	records.sort(
		(a, b) => a.employeeName.localeCompare(b.employeeName) || a.date.localeCompare(b.date)
	);

	return {
		month,
		range,
		punchCount,
		employeeCount: inScope.length,
		unmatched,
		scopeIds,
		records
	};
}

/**
 * Saves a month's generated DTR: replaces that month's earlier biometric rows for the
 * employees in scope, and never touches a manual entry. Recomputes from the punches
 * itself, so what is saved is always current, not whatever was last on screen.
 */
export async function saveMonthDtr(
	hotelId: string,
	month: string,
	employeeId?: string
): Promise<{ saved: number; absent: number; keptManual: number; month: MonthDtr }> {
	const result = await computeMonthDtr(hotelId, month, employeeId);
	const scopeIds = result.scopeIds;
	const writable = result.records.filter((r) => r.action !== 'keep_manual');

	await db.transaction(async (tx) => {
		if (scopeIds.length > 0) {
			await tx
				.delete(dtrEntries)
				.where(
					and(
						eq(dtrEntries.hotelId, hotelId),
						inArray(dtrEntries.source, ['biometric', 'leave', 'calendar']),
						inArray(dtrEntries.employeeId, scopeIds),
						gte(dtrEntries.date, result.range.start),
						lte(dtrEntries.date, result.range.end)
					)
				);
		}
		for (let i = 0; i < writable.length; i += 500) {
			await tx.insert(dtrEntries).values(
				writable.slice(i, i + 500).map((r) => ({
					hotelId,
					employeeId: r.employeeId,
					scheduleId: r.scheduleId,
					date: r.date,
					timeIn: r.timeIn === null ? null : new Date(r.timeIn),
					timeOut: r.timeOut === null ? null : new Date(r.timeOut),
					breakOut: r.breakOut === null ? null : new Date(r.breakOut),
					breakIn: r.breakIn === null ? null : new Date(r.breakIn),
					workedMinutes: r.workedMinutes,
					otMinutes: r.otMinutes,
					nightDiffMinutes: r.nightDiffMinutes,
					tardinessMinutes: r.tardinessMinutes,
					undertimeMinutes: r.undertimeMinutes,
					isAbsent: r.isAbsent,
					remarks: recordRemarks(r) || null,
					leaveRequestId: r.leave?.requestId ?? null,
					calendarDayId: r.calendar?.id ?? null,
					leaveMinutes: r.leaveMinutes,
					source: r.leave && !r.timeIn ? 'leave' : r.calendar && !r.timeIn ? 'calendar' : 'biometric',
					biometricEnrollId: r.enrollId
				}))
			);
		}
	});

	return {
		saved: writable.length,
		absent: writable.filter((r) => r.isAbsent).length,
		keptManual: result.records.filter((r) => r.action === 'keep_manual').length,
		month: result
	};
}
