import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import {
	biometricPunches,
	calendarDays,
	dtrEntries,
	employeeAssignments,
	employees,
	leaveRequests,
	leaveTypes,
	overtimeRequests,
	schedulePeriods,
	schedules
} from '$lib/server/db/schema/index';
import { addDays, monthBounds, mondayOf, weekDates } from '$lib/roster';
import { normalizeEnrollId } from '$lib/hr-import';
import { wallTimeToUtcMs } from '$lib/server/time';
import { getHandoff } from './dtr-submissions';

export interface AttentionItem {
	key: string;
	/** `fix` is something this establishment must do; `wait` is with Main HR. */
	tone: 'fix' | 'wait';
	text: string;
	href: string;
}

export interface Dashboard {
	today: string;
	staffCount: number;
	roster: { working: number; rest: number; onLeave: number; unscheduled: number };
	onLeave: Array<{ name: string; position: string; leaveType: string; start: string; end: string; today: boolean }>;
	week: Array<{ date: string; working: number; isToday: boolean }>;
	/**
	 * Information only — never written to a DTR. Rostered to work today, shift already started, no
	 * punch yet, not on leave. `state` says whether the list can be trusted at all.
	 */
	absentToday: {
		state: 'ok' | 'no_punches_today' | 'holiday';
		holiday: string | null;
		people: Array<{ name: string; position: string; shift: string }>;
	};
	attention: AttentionItem[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const monthOf = (date: string) => date.slice(0, 7);
const prevMonth = (date: string) => monthOf(addDays(`${monthOf(date)}-01`, -1));

/** Everything the establishment dashboard shows, from the establishment's own data only. */
export async function getDashboard(
	establishmentId: string,
	slug: string,
	today: string,
	timezone = 'Asia/Manila',
	nowMs = Date.now()
): Promise<Dashboard> {
	const base = `/${slug}`;
	const weekStart = mondayOf(today);
	const days = weekDates(weekStart);
	const horizon = addDays(today, 7);
	const month = monthOf(today);
	const { start: monthStart } = monthBounds(today);
	const nextWeek = addDays(weekStart, 7);

	const staff = await db
		.select({
			id: employees.id,
			last: employees.lastName,
			first: employees.firstName,
			position: employeeAssignments.position,
			enrollId: employeeAssignments.biometricEnrollId
		})
		.from(employeeAssignments)
		.innerJoin(employees, eq(employees.id, employeeAssignments.employeeId))
		.where(
			and(
				eq(employeeAssignments.establishmentId, establishmentId),
				lte(employeeAssignments.startDate, today),
				sql`(${employeeAssignments.endDate} is null or ${employeeAssignments.endDate} >= ${today})`,
				isNull(employees.deletedAt)
			)
		)
		.orderBy(asc(employees.lastName), asc(employees.firstName));
	const staffIds = staff.map((s) => s.id);
	const byId = new Map(staff.map((s) => [s.id, s]));
	const nameOf = (id: string) => {
		const s = byId.get(id);
		return s ? `${s.last}, ${s.first}` : 'Former employee';
	};

	const [weekRows, leaveRows, filedLeave, filedOt, pendingMemos, weeks, unapprovedOt, openPunches, unscheduledPunches, nextWeekRows] =
		await Promise.all([
			db
				.select({
					employeeId: schedules.employeeId,
					date: schedules.date,
					isRestDay: schedules.isRestDay,
					start: schedules.startTime,
					end: schedules.endTime
				})
				.from(schedules)
				.where(
					and(
						eq(schedules.establishmentId, establishmentId),
						gte(schedules.date, days[0]!),
						lte(schedules.date, days[6]!),
						isNull(schedules.deletedAt)
					)
				),
			db
				.select({
					employeeId: leaveRequests.employeeId,
					start: leaveRequests.startDate,
					end: leaveRequests.endDate,
					type: leaveTypes.name
				})
				.from(leaveRequests)
				.innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
				.where(
					and(
						eq(leaveRequests.establishmentId, establishmentId),
						eq(leaveRequests.status, 'approved'),
						lte(leaveRequests.startDate, days[6]! > horizon ? days[6]! : horizon),
						gte(leaveRequests.endDate, days[0]! < today ? days[0]! : today)
					)
				)
				.orderBy(asc(leaveRequests.startDate)),
			db
				.select({ n: sql<number>`count(*)::int` })
				.from(leaveRequests)
				.where(and(eq(leaveRequests.establishmentId, establishmentId), eq(leaveRequests.status, 'submitted'))),
			db
				.select({ n: sql<number>`count(*)::int` })
				.from(overtimeRequests)
				.where(and(eq(overtimeRequests.establishmentId, establishmentId), eq(overtimeRequests.status, 'submitted'))),
			db
				.select({ n: sql<number>`count(*)::int` })
				.from(calendarDays)
				.where(and(eq(calendarDays.establishmentId, establishmentId), eq(calendarDays.status, 'submitted'))),
			db
				.select({ weekStart: schedulePeriods.weekStart, status: schedulePeriods.status })
				.from(schedulePeriods)
				.where(
					and(
						eq(schedulePeriods.establishmentId, establishmentId),
						gte(schedulePeriods.weekStart, addDays(weekStart, -7)),
						inArray(schedulePeriods.status, ['returned', 'submitted'])
					)
				),
			db
				.select({
					n: sql<number>`count(distinct ${dtrEntries.employeeId})::int`,
					minutes: sql<number>`coalesce(sum(${dtrEntries.unapprovedOtMinutes}), 0)::int`
				})
				.from(dtrEntries)
				.where(
					and(
						eq(dtrEntries.establishmentId, establishmentId),
						gte(dtrEntries.date, monthStart),
						lte(dtrEntries.date, today),
						isNull(dtrEntries.deletedAt),
						sql`${dtrEntries.unapprovedOtMinutes} > 0`
					)
				),
			db
				.select({ n: sql<number>`count(*)::int` })
				.from(dtrEntries)
				.where(
					and(
						eq(dtrEntries.establishmentId, establishmentId),
						gte(dtrEntries.date, monthStart),
						lte(dtrEntries.date, addDays(today, -1)),
						isNull(dtrEntries.deletedAt),
						isNotNull(dtrEntries.timeIn),
						isNull(dtrEntries.timeOut)
					)
				),
			db
				.select({ n: sql<number>`count(*)::int` })
				.from(dtrEntries)
				.where(
					and(
						eq(dtrEntries.establishmentId, establishmentId),
						gte(dtrEntries.date, monthStart),
						lte(dtrEntries.date, addDays(today, -1)),
						isNull(dtrEntries.deletedAt),
						isNotNull(dtrEntries.timeIn),
						isNull(dtrEntries.scheduleId)
					)
				),
			db
				.select({ n: sql<number>`count(*)::int` })
				.from(schedules)
				.where(
					and(
						eq(schedules.establishmentId, establishmentId),
						gte(schedules.date, nextWeek),
						lte(schedules.date, addDays(nextWeek, 6)),
						isNull(schedules.deletedAt)
					)
				)
		]);

	// ---- today's roster
	const onLeaveToday = new Set(leaveRows.filter((l) => l.start <= today && l.end >= today).map((l) => l.employeeId));
	const todayRows = new Map(weekRows.filter((r) => r.date === today).map((r) => [r.employeeId, r]));
	let working = 0;
	let rest = 0;
	let unscheduled = 0;
	for (const id of staffIds) {
		if (onLeaveToday.has(id)) continue;
		const row = todayRows.get(id);
		if (!row) unscheduled += 1;
		else if (row.isRestDay || !row.start) rest += 1;
		else working += 1;
	}

	// ---- week coverage (people on a working shift per day)
	const week = days.map((date) => {
		const away = new Set(leaveRows.filter((l) => l.start <= date && l.end >= date).map((l) => l.employeeId));
		return {
			date,
			isToday: date === today,
			working: new Set(
				weekRows
					.filter((r) => r.date === date && !r.isRestDay && r.start && byId.has(r.employeeId) && !away.has(r.employeeId))
					.map((r) => r.employeeId)
			).size
		};
	});

	// ---- who is on leave
	const onLeave = leaveRows
		.filter((l) => byId.has(l.employeeId) && l.end >= today && l.start <= horizon)
		.map((l) => ({
			name: nameOf(l.employeeId),
			position: byId.get(l.employeeId)?.position ?? '',
			leaveType: l.type,
			start: l.start,
			end: l.end,
			today: l.start <= today && l.end >= today
		}));

	// ---- needs attention
	const attention: AttentionItem[] = [];
	const [cur, prev] = await Promise.all([getHandoff(establishmentId, month), getHandoff(establishmentId, prevMonth(today))]);
	if (cur.status === 'returned') {
		attention.push({
			key: 'dtr-returned',
			tone: 'fix',
			text: `Main HR returned the ${cur.month} DTR${cur.note ? `: "${cur.note}"` : ''}. Correct it and send it again.`,
			href: `${base}/dtr`
		});
	}
	if (prev.status === 'returned') {
		attention.push({
			key: 'dtr-prev-returned',
			tone: 'fix',
			text: `Main HR returned the ${prev.month} DTR${prev.note ? `: "${prev.note}"` : ''}. Correct it and send it again.`,
			href: `${base}/dtr`
		});
	} else if (prev.status === 'draft') {
		const prevBounds = monthBounds(`${prev.month}-01`);
		const had = await db
			.select({ n: sql<number>`count(*)::int` })
			.from(dtrEntries)
			.where(
				and(
					eq(dtrEntries.establishmentId, establishmentId),
					gte(dtrEntries.date, prevBounds.start),
					lte(dtrEntries.date, prevBounds.end),
					isNull(dtrEntries.deletedAt)
				)
			);
		if ((had[0]?.n ?? 0) > 0) {
			attention.push({
				key: 'dtr-prev-unsent',
				tone: 'fix',
				text: `The ${prev.month} DTR has not been sent to Main HR yet.`,
				href: `${base}/dtr`
			});
		}
	}
	for (const w of weeks) {
		if (w.status === 'returned') {
			attention.push({
				key: `week-${w.weekStart}`,
				tone: 'fix',
				text: `Main HR returned the roster for the week of ${w.weekStart}. Revise it and resubmit.`,
				href: `${base}/schedule`
			});
		}
	}
	if ((openPunches[0]?.n ?? 0) > 0) {
		attention.push({
			key: 'missing-out',
			tone: 'fix',
			text: `${plural(openPunches[0]!.n, 'day')} this month with a time-in but no time-out.`,
			href: `${base}/dtr`
		});
	}
	if ((unscheduledPunches[0]?.n ?? 0) > 0) {
		attention.push({
			key: 'no-schedule',
			tone: 'fix',
			text: `${plural(unscheduledPunches[0]!.n, 'punch', 'punches')} this month with no schedule to match.`,
			href: `${base}/dtr`
		});
	}
	if ((unapprovedOt[0]?.n ?? 0) > 0) {
		const m = unapprovedOt[0]!.minutes;
		attention.push({
			key: 'unapproved-ot',
			tone: 'fix',
			text: `${plural(unapprovedOt[0]!.n, 'person', 'people')} worked past their shift this month with no overtime application (${Math.floor(m / 60)}h ${m % 60}m not credited).`,
			href: `${base}/overtime`
		});
	}
	if (staff.length > 0 && (nextWeekRows[0]?.n ?? 0) === 0) {
		attention.push({
			key: 'next-week',
			tone: 'fix',
			text: `Next week's roster (from ${nextWeek}) has not been built.`,
			href: `${base}/schedule`
		});
	}
	const waiting = (filedLeave[0]?.n ?? 0) + (filedOt[0]?.n ?? 0) + (pendingMemos[0]?.n ?? 0);
	if (waiting > 0) {
		attention.push({
			key: 'waiting-hr',
			tone: 'wait',
			text: `${plural(waiting, 'filing')} waiting for Main HR to decide.`,
			href: `${base}/leave`
		});
	}
	const submittedWeeks = weeks.filter((w) => w.status === 'submitted').length;
	if (submittedWeeks > 0) {
		attention.push({
			key: 'weeks-waiting',
			tone: 'wait',
			text: `${plural(submittedWeeks, 'roster week')} waiting for Main HR to approve.`,
			href: `${base}/schedule`
		});
	}
	if (cur.status === 'submitted') {
		attention.push({
			key: 'dtr-waiting',
			tone: 'wait',
			text: `The ${cur.month} DTR is with Main HR, waiting to be received.`,
			href: `${base}/dtr`
		});
	}

	// ---- absent today (information only)
	const dayStart = wallTimeToUtcMs(today, '00:00:00', timezone);
	const dayEnd = wallTimeToUtcMs(addDays(today, 1), '00:00:00', timezone);
	const [todayPunches, todayCalendar, todayDtr] = await Promise.all([
		db
			.select({ enrollKey: biometricPunches.enrollKey })
			.from(biometricPunches)
			.where(
				and(
					eq(biometricPunches.establishmentId, establishmentId),
					gte(biometricPunches.punchedAt, new Date(dayStart)),
					lte(biometricPunches.punchedAt, new Date(dayEnd))
				)
			),
		db
			.select({ name: calendarDays.name })
			.from(calendarDays)
			.where(
				and(
					eq(calendarDays.establishmentId, establishmentId),
					eq(calendarDays.date, today),
					eq(calendarDays.status, 'approved')
				)
			),
		db
			.select({ employeeId: dtrEntries.employeeId })
			.from(dtrEntries)
			.where(
				and(
					eq(dtrEntries.establishmentId, establishmentId),
					eq(dtrEntries.date, today),
					isNull(dtrEntries.deletedAt),
					isNotNull(dtrEntries.timeIn)
				)
			)
	]);
	const absentToday: Dashboard['absentToday'] = { state: 'ok', holiday: null, people: [] };
	if (todayCalendar.length > 0) {
		absentToday.state = 'holiday';
		absentToday.holiday = todayCalendar[0]!.name;
	} else if (todayPunches.length === 0) {
		// Nothing synced for today: everyone would look absent, which would be false.
		absentToday.state = 'no_punches_today';
	} else {
		const punched = new Set(todayPunches.map((p) => p.enrollKey));
		const hasEntry = new Set(todayDtr.map((r) => r.employeeId));
		const hm = (t: string | null) => (t ? t.slice(0, 5) : '');
		for (const s of staff) {
			const row = todayRows.get(s.id);
			if (!row || row.isRestDay || !row.start) continue;
			if (onLeaveToday.has(s.id) || hasEntry.has(s.id)) continue;
			if (!s.enrollId) continue; // no biometric ID: cannot be told either way
			if (nowMs < wallTimeToUtcMs(today, row.start, timezone)) continue; // shift not started yet
			if (punched.has(normalizeEnrollId(s.enrollId))) continue;
			absentToday.people.push({
				name: `${s.last}, ${s.first}`,
				position: s.position,
				shift: `${hm(row.start)}–${hm(row.end)}`
			});
		}
	}

	return {
		today,
		staffCount: staff.length,
		absentToday,
		roster: { working, rest, onLeave: staffIds.filter((id) => onLeaveToday.has(id)).length, unscheduled },
		onLeave,
		week,
		attention
	};
}
