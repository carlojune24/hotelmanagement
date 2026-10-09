import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import {
	employees,
	leaveAdjustments,
	leaveRequests,
	leaveTypes
} from '$lib/server/db/schema/index';
import {
	EMPLOYMENT_TYPES,
	LEAVE_DEFAULTS,
	countLeaveDays,
	eligibilityError,
	leavesOverlap,
	type LeavePolicy
} from '$lib/leave';
import { datesBetween } from '$lib/roster';
import { listSchedules } from '$lib/server/hr/schedules';

export class LeaveError extends Error {}

type LeaveTypeRow = typeof leaveTypes.$inferSelect;

// ---------------------------------------------------------------------------
// Policy (leave types)
// ---------------------------------------------------------------------------

export const leaveTypeSchema = z.object({
	code: z
		.string()
		.trim()
		.toUpperCase()
		.regex(/^[A-Z0-9]{1,8}$/, 'Code is 1–8 letters or digits, e.g. SL.'),
	name: z.string().trim().min(1, 'Give the leave a name.').max(80),
	description: z.string().trim().max(600).default(''),
	paid: z.boolean(),
	daysPerYear: z.coerce.number().min(0).max(366),
	dayCount: z.enum(['working', 'calendar']),
	minServiceMonths: z.coerce.number().int().min(0).max(240),
	employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).default([]),
	sexRestriction: z.enum(['male', 'female']).nullable(),
	halfDayAllowed: z.boolean(),
	carryOverDays: z.coerce.number().min(0).max(366),
	cashConvertible: z.boolean(),
	requiresDocument: z.boolean(),
	active: z.boolean()
});
export type LeaveTypeInput = z.infer<typeof leaveTypeSchema>;

const asValues = (p: LeavePolicy | LeaveTypeInput) => ({
	code: p.code,
	name: p.name,
	description: p.description || null,
	paid: p.paid,
	daysPerYear: p.daysPerYear,
	dayCount: p.dayCount,
	minServiceMonths: p.minServiceMonths,
	employmentTypes: p.employmentTypes,
	sexRestriction: p.sexRestriction,
	halfDayAllowed: p.halfDayAllowed,
	carryOverDays: p.carryOverDays,
	cashConvertible: p.cashConvertible,
	requiresDocument: p.requiresDocument,
	active: p.active
});

/** Adds any default leave the hotel does not have yet; never touches ones it has edited. */
export async function seedLeaveDefaults(hotelId: string) {
	const existing = await db
		.select({ code: leaveTypes.code })
		.from(leaveTypes)
		.where(eq(leaveTypes.hotelId, hotelId));
	const have = new Set(existing.map((e) => e.code));
	const missing = LEAVE_DEFAULTS.filter((d) => !have.has(d.code));
	if (missing.length === 0) return 0;
	await db.insert(leaveTypes).values(
		missing.map((d) => ({
			hotelId,
			...asValues(d),
			statutory: d.statutory,
			sortOrder: LEAVE_DEFAULTS.indexOf(d)
		}))
	);
	return missing.length;
}

/** Puts the statutory leaves back to the law's defaults (company leaves are left alone). */
export async function restoreStatutoryDefaults(hotelId: string) {
	await seedLeaveDefaults(hotelId);
	for (const d of LEAVE_DEFAULTS.filter((x) => x.statutory)) {
		await db
			.update(leaveTypes)
			.set({ ...asValues(d), updatedAt: new Date() })
			.where(and(eq(leaveTypes.hotelId, hotelId), eq(leaveTypes.code, d.code)));
	}
}

export async function listLeaveTypes(hotelId: string): Promise<LeaveTypeRow[]> {
	await seedLeaveDefaults(hotelId);
	return db
		.select()
		.from(leaveTypes)
		.where(eq(leaveTypes.hotelId, hotelId))
		.orderBy(asc(leaveTypes.sortOrder), asc(leaveTypes.name));
}

export async function getLeaveType(hotelId: string, id: string) {
	const [row] = await db
		.select()
		.from(leaveTypes)
		.where(and(eq(leaveTypes.hotelId, hotelId), eq(leaveTypes.id, id)));
	return row ?? null;
}

/** Creates (no `id`) or amends a leave type. Returns the row before and after, for the audit trail. */
export async function saveLeaveType(hotelId: string, input: LeaveTypeInput, id?: string) {
	const [dupe] = await db
		.select({ id: leaveTypes.id })
		.from(leaveTypes)
		.where(and(eq(leaveTypes.hotelId, hotelId), eq(leaveTypes.code, input.code)));
	if (dupe && dupe.id !== id) throw new LeaveError(`There is already a leave with the code ${input.code}.`);

	if (!id) {
		const [after] = await db
			.insert(leaveTypes)
			.values({ hotelId, ...asValues(input), sortOrder: 100 })
			.returning();
		return { before: null, after: after! };
	}
	const before = await getLeaveType(hotelId, id);
	if (!before) throw new LeaveError('That leave no longer exists.');
	const [after] = await db
		.update(leaveTypes)
		.set({ ...asValues(input), updatedAt: new Date() })
		.where(and(eq(leaveTypes.hotelId, hotelId), eq(leaveTypes.id, id)))
		.returning();
	return { before, after: after! };
}

export async function deleteLeaveType(hotelId: string, id: string) {
	const [used] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(leaveRequests)
		.where(and(eq(leaveRequests.hotelId, hotelId), eq(leaveRequests.leaveTypeId, id)));
	if ((used?.n ?? 0) > 0) {
		throw new LeaveError('This leave has requests on file, so it can’t be deleted. Switch it off instead.');
	}
	await db.delete(leaveTypes).where(and(eq(leaveTypes.hotelId, hotelId), eq(leaveTypes.id, id)));
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const leaveFormSchema = z
	.object({
		employeeId: z.string().uuid('Choose the employee.'),
		leaveTypeId: z.string().uuid('Choose the leave type.'),
		startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the first day.'),
		endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the last day.'),
		halfDay: z.enum(['am', 'pm']).nullable(),
		reason: z.string().trim().max(500).default(''),
		documentNote: z.string().trim().max(300).default('')
	})
	.refine((v) => v.endDate >= v.startDate, { message: 'The last day is before the first.', path: ['endDate'] })
	.refine((v) => !v.halfDay || v.startDate === v.endDate, {
		message: 'A half day is a single date.',
		path: ['halfDay']
	});
export type LeaveFormInput = z.infer<typeof leaveFormSchema>;

/** Dates the employee is rostered to work in a range. */
async function workDatesFor(hotelId: string, employeeId: string, start: string, end: string) {
	const roster = await listSchedules(hotelId, start, end);
	return new Set(
		roster
			.filter((s) => s.employeeId === employeeId && !s.isRestDay && s.startTime)
			.map((s) => s.date)
	);
}

type BalanceLine = { entitled: number; carried: number; adjusted: number; used: number; remaining: number };

async function balanceFor(
	hotelId: string,
	employeeId: string,
	type: LeaveTypeRow,
	year: number
): Promise<BalanceLine> {
	const yearOf = (y: number) => ({ from: `${y}-01-01`, to: `${y}-12-31` });
	const usedIn = async (y: number) => {
		const { from, to } = yearOf(y);
		const [r] = await db
			.select({ n: sql<number>`coalesce(sum(${leaveRequests.days}), 0)::float` })
			.from(leaveRequests)
			.where(
				and(
					eq(leaveRequests.hotelId, hotelId),
					eq(leaveRequests.employeeId, employeeId),
					eq(leaveRequests.leaveTypeId, type.id),
					eq(leaveRequests.status, 'approved'),
					gte(leaveRequests.startDate, from),
					lte(leaveRequests.startDate, to)
				)
			);
		return r?.n ?? 0;
	};
	const adjIn = async (y: number) => {
		const [r] = await db
			.select({ n: sql<number>`coalesce(sum(${leaveAdjustments.days}), 0)::float` })
			.from(leaveAdjustments)
			.where(
				and(
					eq(leaveAdjustments.hotelId, hotelId),
					eq(leaveAdjustments.employeeId, employeeId),
					eq(leaveAdjustments.leaveTypeId, type.id),
					eq(leaveAdjustments.year, y)
				)
			);
		return r?.n ?? 0;
	};
	const [used, adjusted, prevUsed, prevAdj] = await Promise.all([
		usedIn(year),
		adjIn(year),
		type.carryOverDays > 0 ? usedIn(year - 1) : 0,
		type.carryOverDays > 0 ? adjIn(year - 1) : 0
	]);
	const carried =
		type.carryOverDays > 0
			? Math.min(type.carryOverDays, Math.max(0, type.daysPerYear + prevAdj - prevUsed))
			: 0;
	const entitled = type.daysPerYear;
	return { entitled, carried, adjusted, used, remaining: entitled + carried + adjusted - used };
}

/** What a request would count and leave behind, for the filing dialog and for validation. */
export async function previewLeave(hotelId: string, input: LeaveFormInput) {
	const [type, emp] = await Promise.all([
		getLeaveType(hotelId, input.leaveTypeId),
		db
			.select()
			.from(employees)
			.where(and(eq(employees.hotelId, hotelId), eq(employees.id, input.employeeId)))
			.then((r) => r[0])
	]);
	if (!type) throw new LeaveError('That leave type no longer exists.');
	if (!emp) throw new LeaveError('That employee no longer exists.');
	if (!type.active) throw new LeaveError(`${type.name} is switched off in settings.`);

	const why = eligibilityError(
		{
			name: type.name,
			minServiceMonths: type.minServiceMonths,
			employmentTypes: type.employmentTypes,
			sexRestriction: type.sexRestriction as 'male' | 'female' | null
		},
		{ hiredOn: emp.hiredOn, employmentType: emp.employmentType, sex: emp.sex },
		input.startDate
	);
	if (why) throw new LeaveError(why);
	if (input.halfDay && !type.halfDayAllowed) throw new LeaveError(`${type.name} can’t be taken as a half day.`);

	const workDates = await workDatesFor(hotelId, emp.id, input.startDate, input.endDate);
	const days = countLeaveDays({
		dayCount: type.dayCount as 'working' | 'calendar',
		start: input.startDate,
		end: input.endDate,
		workDates,
		halfDay: input.halfDay
	});
	if (days === 0) {
		throw new LeaveError(
			type.dayCount === 'working'
				? 'No working day on the schedule in that range. Set the schedule first, or pick other dates.'
				: 'No days in that range.'
		);
	}

	const clash = await db
		.select({ start: leaveRequests.startDate, end: leaveRequests.endDate, halfDay: leaveRequests.halfDay })
		.from(leaveRequests)
		.where(
			and(
				eq(leaveRequests.hotelId, hotelId),
				eq(leaveRequests.employeeId, emp.id),
				eq(leaveRequests.status, 'approved'),
				lte(leaveRequests.startDate, input.endDate),
				gte(leaveRequests.endDate, input.startDate)
			)
		);
	const me = { start: input.startDate, end: input.endDate, halfDay: input.halfDay };
	if (clash.some((c) => leavesOverlap(me, c))) {
		throw new LeaveError('This person already has leave on some of those dates.');
	}

	const year = Number(input.startDate.slice(0, 4));
	const bal = await balanceFor(hotelId, emp.id, type, year);
	const capped = type.daysPerYear > 0;
	return { type, emp, days, balance: bal, capped, after: bal.remaining - days };
}

export async function fileLeave(hotelId: string, input: LeaveFormInput, userId: string | null) {
	const p = await previewLeave(hotelId, input);
	if (p.capped && p.after < 0) {
		throw new LeaveError(
			`${p.type.name}: ${p.days} day${p.days === 1 ? '' : 's'} is more than the ${p.balance.remaining} left this year.`
		);
	}
	const [row] = await db
		.insert(leaveRequests)
		.values({
			hotelId,
			employeeId: p.emp.id,
			leaveTypeId: p.type.id,
			startDate: input.startDate,
			endDate: input.endDate,
			halfDay: input.halfDay,
			days: p.days,
			paid: p.type.paid,
			reason: input.reason || null,
			documentNote: input.documentNote || null,
			status: 'approved',
			filedByUserId: userId
		})
		.returning();
	return { request: row!, type: p.type, emp: p.emp };
}

export async function cancelLeave(hotelId: string, id: string, note: string, userId: string | null) {
	const [row] = await db
		.update(leaveRequests)
		.set({
			status: 'cancelled',
			cancelledAt: new Date(),
			cancelledByUserId: userId,
			cancelNote: note || null,
			updatedAt: new Date()
		})
		.where(and(eq(leaveRequests.hotelId, hotelId), eq(leaveRequests.id, id), ne(leaveRequests.status, 'cancelled')))
		.returning();
	if (!row) throw new LeaveError('That leave is already cancelled.');
	return row;
}

export async function listLeaveRequests(hotelId: string, year: number) {
	return db
		.select({
			id: leaveRequests.id,
			employeeId: leaveRequests.employeeId,
			employeeName: sql<string>`${employees.lastName} || ', ' || ${employees.firstName}`,
			leaveTypeId: leaveRequests.leaveTypeId,
			code: leaveTypes.code,
			typeName: leaveTypes.name,
			startDate: leaveRequests.startDate,
			endDate: leaveRequests.endDate,
			halfDay: leaveRequests.halfDay,
			days: leaveRequests.days,
			paid: leaveRequests.paid,
			reason: leaveRequests.reason,
			documentNote: leaveRequests.documentNote,
			status: leaveRequests.status,
			cancelNote: leaveRequests.cancelNote,
			createdAt: leaveRequests.createdAt
		})
		.from(leaveRequests)
		.innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
		.innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
		.where(
			and(
				eq(leaveRequests.hotelId, hotelId),
				gte(leaveRequests.endDate, `${year}-01-01`),
				lte(leaveRequests.startDate, `${year}-12-31`)
			)
		)
		.orderBy(desc(leaveRequests.startDate));
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

export const adjustmentSchema = z.object({
	employeeId: z.string().uuid(),
	leaveTypeId: z.string().uuid(),
	year: z.coerce.number().int().min(2000).max(2100),
	days: z.coerce.number().min(-366).max(366).refine((n) => n !== 0, 'Enter a number of days.'),
	reason: z.string().trim().min(3, 'Say what the adjustment is for.').max(300)
});

export async function addAdjustment(
	hotelId: string,
	input: z.infer<typeof adjustmentSchema>,
	userId: string | null
) {
	const [row] = await db
		.insert(leaveAdjustments)
		.values({ hotelId, ...input, createdByUserId: userId })
		.returning();
	return row!;
}

/** Every employee × active leave type for a year: entitled, carried, adjusted, used, remaining. */
export async function leaveBalances(hotelId: string, year: number) {
	const [types, emps] = await Promise.all([
		listLeaveTypes(hotelId).then((t) => t.filter((x) => x.active)),
		db.select().from(employees).where(and(eq(employees.hotelId, hotelId))).orderBy(asc(employees.lastName))
	]);
	const people = emps.filter((e) => !e.deletedAt && e.status !== 'separated');
	const rows = await Promise.all(
		people.map(async (e) => ({
			employeeId: e.id,
			name: `${e.lastName}, ${e.firstName}`,
			lines: await Promise.all(
				types.map(async (t) => ({ typeId: t.id, ...(await balanceFor(hotelId, e.id, t, year)) }))
			)
		}))
	);
	return { types, rows };
}

// ---------------------------------------------------------------------------
// Days — for the roster overlay and the DTR
// ---------------------------------------------------------------------------

export type LeaveDay = {
	requestId: string;
	code: string;
	name: string;
	paid: boolean;
	halfDay: 'am' | 'pm' | null;
};

/** `${employeeId}|${date}` → the approved leave covering that day, within [from, to]. */
export async function listLeaveDays(
	hotelId: string,
	from: string,
	to: string,
	employeeIds?: string[]
): Promise<Map<string, LeaveDay>> {
	const rows = await db
		.select({
			id: leaveRequests.id,
			employeeId: leaveRequests.employeeId,
			start: leaveRequests.startDate,
			end: leaveRequests.endDate,
			halfDay: leaveRequests.halfDay,
			paid: leaveRequests.paid,
			code: leaveTypes.code,
			name: leaveTypes.name
		})
		.from(leaveRequests)
		.innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
		.where(
			and(
				eq(leaveRequests.hotelId, hotelId),
				eq(leaveRequests.status, 'approved'),
				lte(leaveRequests.startDate, to),
				gte(leaveRequests.endDate, from),
				employeeIds ? inArray(leaveRequests.employeeId, employeeIds) : undefined
			)
		);
	const out = new Map<string, LeaveDay>();
	for (const r of rows) {
		const start = r.start < from ? from : r.start;
		const end = r.end > to ? to : r.end;
		for (const date of datesBetween(start, end)) {
			out.set(`${r.employeeId}|${date}`, {
				requestId: r.id,
				code: r.code,
				name: r.name,
				paid: r.paid,
				halfDay: r.halfDay as 'am' | 'pm' | null
			});
		}
	}
	return out;
}
