import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { employees, schedules } from '$lib/server/db/schema/index';
import {
	addDays,
	breakWindowError,
	breakWindowMinutes,
	isDateString,
	shiftSpanMinutes,
	toHHMM
} from '$lib/roster';

export class ScheduleError extends Error {}

/** A bulk edit never touches more cells than a full month for a large team. */
export const MAX_CELLS_PER_EDIT = 600;

const hhmm = z.string().regex(/^\d{2}:\d{2}$/);
const dateStr = z.string().refine(isDateString, 'Not a valid date');

export const cellRefSchema = z.object({ employeeId: z.string().uuid(), date: dateStr });
export type CellRef = z.infer<typeof cellRefSchema>;

/** What a roster cell holds. A rest day carries no times; a working shift needs both and they must differ. */
export const cellShiftSchema = z
	.object({
		isRestDay: z.boolean(),
		startTime: hhmm.nullable().optional(),
		endTime: hhmm.nullable().optional(),
		breakMinutes: z.coerce.number().int().min(0).max(600).default(0),
		/** Split shift: both or neither. `breakMinutes` is then derived from them. */
		breakStart: hhmm.nullable().optional(),
		breakEnd: hhmm.nullable().optional()
	})
	.superRefine((v, ctx) => {
		if (v.isRestDay) return;
		if (!v.startTime || !v.endTime || shiftSpanMinutes(v.startTime, v.endTime) === 0) {
			ctx.addIssue({
				code: 'custom',
				path: ['startTime'],
				message: 'Enter a start and end time that differ.'
			});
			return;
		}
		if (v.breakStart || v.breakEnd) {
			const msg = breakWindowError(v.startTime, v.endTime, v.breakStart, v.breakEnd);
			if (msg) ctx.addIssue({ code: 'custom', path: ['breakStart'], message: msg });
		}
	});
export type CellShift = {
	isRestDay: boolean;
	startTime: string | null;
	endTime: string | null;
	breakMinutes: number;
	breakStart: string | null;
	breakEnd: string | null;
};

/** A cell and what it held (`null` = empty) — the payload Undo sends back to `restoreCells`. */
export const cellStateSchema = cellRefSchema.extend({ shift: cellShiftSchema.nullable() });
export type CellState = { employeeId: string; date: string; shift: CellShift | null };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const key = (c: CellRef) => `${c.employeeId}|${c.date}`;

function normalizeShift(s: z.infer<typeof cellShiftSchema>): CellShift {
	if (s.isRestDay) {
		return {
			isRestDay: true,
			startTime: null,
			endTime: null,
			breakMinutes: 0,
			breakStart: null,
			breakEnd: null
		};
	}
	const split = Boolean(s.breakStart && s.breakEnd);
	return {
		isRestDay: false,
		startTime: s.startTime ?? null,
		endTime: s.endTime ?? null,
		// A split shift's unpaid break is exactly the gap between its two parts.
		breakMinutes: split ? breakWindowMinutes(s.breakStart, s.breakEnd) : s.breakMinutes,
		breakStart: split ? s.breakStart! : null,
		breakEnd: split ? s.breakEnd! : null
	};
}

function dedupe(cells: CellRef[]): CellRef[] {
	return [...new Map(cells.map((c) => [key(c), c])).values()];
}

/** `schedules.employee_id` is not hotel-scoped by its FK — every write proves the employee is this hotel's. */
async function assertEmployees(tx: Tx, hotelId: string, ids: string[]) {
	const unique = [...new Set(ids)];
	if (unique.length === 0) return;
	const rows = await tx
		.select({ id: employees.id })
		.from(employees)
		.where(
			and(
				eq(employees.hotelId, hotelId),
				isNull(employees.deletedAt),
				inArray(employees.id, unique)
			)
		);
	if (rows.length !== unique.length) throw new ScheduleError('Unknown employee.');
}

async function readCells(tx: Tx, hotelId: string, cells: CellRef[]) {
	if (cells.length === 0) return new Map<string, CellShift & { id: string }>();
	const wanted = new Set(cells.map(key));
	const rows = await tx
		.select()
		.from(schedules)
		.where(
			and(
				eq(schedules.hotelId, hotelId),
				isNull(schedules.deletedAt),
				inArray(schedules.employeeId, [...new Set(cells.map((c) => c.employeeId))]),
				inArray(schedules.date, [...new Set(cells.map((c) => c.date))])
			)
		);
	const out = new Map<string, CellShift & { id: string }>();
	for (const r of rows) {
		const k = key({ employeeId: r.employeeId, date: r.date });
		if (!wanted.has(k)) continue;
		out.set(k, {
			id: r.id,
			isRestDay: r.isRestDay,
			startTime: toHHMM(r.startTime),
			endTime: toHHMM(r.endTime),
			breakMinutes: r.breakMinutes,
			breakStart: toHHMM(r.breakStart),
			breakEnd: toHHMM(r.breakEnd)
		});
	}
	return out;
}

async function upsertRows(tx: Tx, hotelId: string, rows: Array<CellRef & { shift: CellShift }>) {
	if (rows.length === 0) return;
	await tx
		.insert(schedules)
		.values(
			rows.map((r) => ({
				hotelId,
				employeeId: r.employeeId,
				date: r.date,
				isRestDay: r.shift.isRestDay,
				startTime: r.shift.startTime,
				endTime: r.shift.endTime,
				breakMinutes: r.shift.breakMinutes,
				breakStart: r.shift.breakStart,
				breakEnd: r.shift.breakEnd
			}))
		)
		.onConflictDoUpdate({
			target: [schedules.employeeId, schedules.date],
			set: {
				isRestDay: sql`excluded.is_rest_day`,
				startTime: sql`excluded.start_time`,
				endTime: sql`excluded.end_time`,
				breakMinutes: sql`excluded.break_minutes`,
				breakStart: sql`excluded.break_start`,
				breakEnd: sql`excluded.break_end`,
				deletedAt: null,
				updatedAt: new Date()
			}
		});
}

function toState(cell: CellRef, prev: CellShift | undefined): CellState {
	return {
		employeeId: cell.employeeId,
		date: cell.date,
		shift: prev
			? {
					isRestDay: prev.isRestDay,
					startTime: prev.startTime,
					endTime: prev.endTime,
					breakMinutes: prev.breakMinutes,
					breakStart: prev.breakStart,
					breakEnd: prev.breakEnd
				}
			: null
	};
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** One hotel's roster for `[from, to]` (inclusive), times normalised to `HH:MM`. */
export async function listSchedules(hotelId: string, from: string, to: string) {
	const rows = await db
		.select({
			id: schedules.id,
			employeeId: schedules.employeeId,
			date: schedules.date,
			isRestDay: schedules.isRestDay,
			startTime: schedules.startTime,
			endTime: schedules.endTime,
			breakMinutes: schedules.breakMinutes,
			breakStart: schedules.breakStart,
			breakEnd: schedules.breakEnd
		})
		.from(schedules)
		.where(
			and(
				eq(schedules.hotelId, hotelId),
				isNull(schedules.deletedAt),
				gte(schedules.date, from),
				lte(schedules.date, to)
			)
		)
		.orderBy(asc(schedules.date));
	return rows.map((r) => ({
		...r,
		startTime: toHHMM(r.startTime),
		endTime: toHHMM(r.endTime),
		breakStart: toHHMM(r.breakStart),
		breakEnd: toHHMM(r.breakEnd)
	}));
}

// ---------------------------------------------------------------------------
// Bulk writes — one transaction each; each returns the cells' previous state for Undo
// ---------------------------------------------------------------------------

/** Paints the same shift (or rest day) onto every cell, replacing whatever was there. */
export async function applyShiftToCells(
	hotelId: string,
	cellsIn: CellRef[],
	shiftIn: z.infer<typeof cellShiftSchema>
): Promise<{ applied: number; previous: CellState[] }> {
	const cells = dedupe(cellsIn);
	if (cells.length === 0) return { applied: 0, previous: [] };
	if (cells.length > MAX_CELLS_PER_EDIT) throw new ScheduleError('Too many days selected at once.');
	const shift = normalizeShift(shiftIn);

	return db.transaction(async (tx) => {
		await assertEmployees(
			tx,
			hotelId,
			cells.map((c) => c.employeeId)
		);
		const before = await readCells(tx, hotelId, cells);
		await upsertRows(
			tx,
			hotelId,
			cells.map((c) => ({ ...c, shift }))
		);
		return { applied: cells.length, previous: cells.map((c) => toState(c, before.get(key(c)))) };
	});
}

/**
 * Empties cells. Rows are deleted outright (as before); `dtr_entries.schedule_id` is
 * `ON DELETE SET NULL`, so a time record for that day survives, merely unpaired.
 */
export async function clearCells(
	hotelId: string,
	cellsIn: CellRef[]
): Promise<{ cleared: number; previous: CellState[] }> {
	const cells = dedupe(cellsIn);
	if (cells.length === 0) return { cleared: 0, previous: [] };
	if (cells.length > MAX_CELLS_PER_EDIT) throw new ScheduleError('Too many days selected at once.');

	return db.transaction(async (tx) => {
		await assertEmployees(
			tx,
			hotelId,
			cells.map((c) => c.employeeId)
		);
		const before = await readCells(tx, hotelId, cells);
		const ids = [...before.values()].map((b) => b.id);
		if (ids.length > 0) {
			await tx
				.delete(schedules)
				.where(and(eq(schedules.hotelId, hotelId), inArray(schedules.id, ids)));
		}
		return {
			cleared: ids.length,
			previous: cells.filter((c) => before.has(key(c))).map((c) => toState(c, before.get(key(c))))
		};
	});
}

/**
 * Copies one week's shifts onto another (`offset` = whole weeks apart, derived from the two
 * Mondays). By default an occupied target cell is left alone; `overwrite` replaces it. Shifts
 * of employees who've since been deleted are skipped.
 */
export async function copyWeek(
	hotelId: string,
	fromWeekStart: string,
	toWeekStart: string,
	overwrite: boolean
): Promise<{ copied: number; skipped: number; previous: CellState[] }> {
	if (fromWeekStart === toWeekStart) throw new ScheduleError('Pick a different week to copy from.');

	return db.transaction(async (tx) => {
		const source = await tx
			.select({
				employeeId: schedules.employeeId,
				date: schedules.date,
				isRestDay: schedules.isRestDay,
				startTime: schedules.startTime,
				endTime: schedules.endTime,
				breakMinutes: schedules.breakMinutes,
				breakStart: schedules.breakStart,
				breakEnd: schedules.breakEnd
			})
			.from(schedules)
			.innerJoin(
				employees,
				and(eq(employees.id, schedules.employeeId), isNull(employees.deletedAt))
			)
			.where(
				and(
					eq(schedules.hotelId, hotelId),
					isNull(schedules.deletedAt),
					gte(schedules.date, fromWeekStart),
					lte(schedules.date, addDays(fromWeekStart, 6))
				)
			);

		const dayOffset = Math.round(
			(new Date(`${toWeekStart}T00:00:00Z`).getTime() -
				new Date(`${fromWeekStart}T00:00:00Z`).getTime()) /
				86_400_000
		);
		const targets = source.map((s) => ({
			employeeId: s.employeeId,
			date: addDays(s.date, dayOffset),
			shift: {
				isRestDay: s.isRestDay,
				startTime: toHHMM(s.startTime),
				endTime: toHHMM(s.endTime),
				breakMinutes: s.breakMinutes,
				breakStart: toHHMM(s.breakStart),
				breakEnd: toHHMM(s.breakEnd)
			} satisfies CellShift
		}));

		const existing = await readCells(tx, hotelId, targets);
		const toWrite = targets.filter((t) => overwrite || !existing.has(key(t)));
		await upsertRows(tx, hotelId, toWrite);
		return {
			copied: toWrite.length,
			skipped: targets.length - toWrite.length,
			previous: toWrite.map((t) => toState(t, existing.get(key(t))))
		};
	});
}

/** Undo: puts each cell back the way it was (`shift: null` → empty). */
export async function restoreCells(hotelId: string, statesIn: z.infer<typeof cellStateSchema>[]) {
	const byKey = new Map(statesIn.map((s) => [key(s), s]));
	const states = [...byKey.values()];
	if (states.length === 0) return { restored: 0 };
	if (states.length > MAX_CELLS_PER_EDIT) throw new ScheduleError('Too many days at once.');

	return db.transaction(async (tx) => {
		await assertEmployees(
			tx,
			hotelId,
			states.map((s) => s.employeeId)
		);
		const empty = states.filter((s) => s.shift === null);
		const filled = states.filter((s) => s.shift !== null);

		const existing = await readCells(tx, hotelId, empty);
		const ids = [...existing.values()].map((e) => e.id);
		if (ids.length > 0) {
			await tx
				.delete(schedules)
				.where(and(eq(schedules.hotelId, hotelId), inArray(schedules.id, ids)));
		}
		await upsertRows(
			tx,
			hotelId,
			filled.map((s) => ({
				employeeId: s.employeeId,
				date: s.date,
				shift: normalizeShift(s.shift!)
			}))
		);
		return { restored: states.length };
	});
}
