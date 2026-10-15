/**
 * Every DTR situation the engine is expected to handle, as data. One source for three things:
 * the unit test (`dtr-scenarios.test.ts` asserts each `expect`), the Guide tab under DTR (renders
 * the table with the minutes the engine really produces), and the sample data HR can load.
 * Pure: no database. Times are wall-clock on a single sample date; `+1` means the next day.
 */
import { creditOvertime } from './overtime';
import {
	DEFAULT_NIGHT_WINDOW,
	applyCredits,
	flagsAfterCredit,
	clusterPunches,
	computeMetrics,
	nightWindowParts,
	recordRemarks,
	type DtrFlag,
	type ScheduleInput
} from './hr-import';
import { timeToMinutes } from './roster';

export const SAMPLE_DATE = '2026-03-10';

export type ScheduleKey = 'split' | 'plain' | 'night' | 'rest' | 'none';

export const SCHEDULES: Record<
	ScheduleKey,
	{ label: string; short: string; start?: string; end?: string; breakStart?: string; breakEnd?: string; breakMinutes?: number; rest?: boolean }
> = {
	split: { label: 'Split shift 8:00 AM–12:00 PM · 1:00 PM–5:00 PM', short: '8–12 · 1–5', start: '08:00', end: '17:00', breakStart: '12:00', breakEnd: '13:00', breakMinutes: 60 },
	plain: { label: 'Straight shift 8:00 AM–5:00 PM, 1h unpaid break (no break window)', short: '8–5', start: '08:00', end: '17:00', breakMinutes: 60 },
	night: { label: 'Night shift 10:00 PM–6:00 AM, break 2:00–3:00 AM', short: '10p–6a', start: '22:00', end: '06:00+1', breakStart: '02:00+1', breakEnd: '03:00+1', breakMinutes: 60 },
	rest: { label: 'Rest day', short: 'Rest day', rest: true },
	none: { label: 'No schedule on the roster', short: 'No schedule' }
};

export type Leave = { paid: boolean; halfDay: 'am' | 'pm' | null };
export type Memo = { creditHours: number | null; waiveLateness: boolean };

export interface Scenario {
	id: string;
	group: 'split' | 'plain' | 'night' | 'overtime' | 'leave' | 'absence';
	title: string;
	schedule: ScheduleKey;
	/** Biometric punches in time order, `HH:MM` (`+1` = next day). */
	punches: string[];
	/** Approved overtime applications for the day, `HH:MM-HH:MM`. */
	approvedOt?: string[];
	leave?: Leave;
	memo?: Memo;
	/** What the engine must produce (minutes). Omitted fields are 0. */
	expect: {
		worked: number;
		late?: number;
		under?: number;
		ot?: number;
		unapprovedOt?: number;
		night?: number;
		flags?: DtrFlag[];
		/** True when a rostered working day has nothing at all (the Absent record). */
		absent?: boolean;
		leaveCredit?: number;
	};
	/** What it means and what HR should do — written for the person reading the DTR. */
	note: string;
}

const L = (id: string, group: Scenario['group'], title: string, schedule: ScheduleKey, punches: string[], expect: Scenario['expect'], note: string, extra: Partial<Scenario> = {}): Scenario => ({
	id, group, title, schedule, punches, expect, note, ...extra
});

export const SCENARIOS: Scenario[] = [
	// ---- A. split shift ----
	L('A1', 'split', 'Perfect day', 'split', ['08:00', '12:00', '13:00', '17:00'], { worked: 480 }, 'In, out for lunch, back, out: 4h + 4h.'),
	L('A2', 'split', 'Late in (8:12) and late back from lunch (1:05)', 'split', ['08:12', '12:00', '13:05', '17:00'], { worked: 463, late: 17 }, 'Lateness is 12 min in the morning plus 5 min after lunch. Both come off the day.'),
	L('A3', 'split', 'No break-out and no break-in', 'split', ['08:00', '17:00'], { worked: 0, flags: ['missing_break_out', 'missing_break_in'] }, 'The break is defined, so it has to be punched. With neither lunch tap nothing proves either half, and the day is treated as absent until HR adds the taps.'),
	L('A4', 'split', 'No break-out (back from lunch only)', 'split', ['08:00', '13:00', '17:00'], { worked: 240, under: 240, flags: ['missing_break_out'] }, 'The morning cannot be proven without the break-out, so the whole first part (4h) is undertime. Flagged "No break-out punch". HR can add the tap to restore it.'),
	L('A5', 'split', 'No break-in (left for lunch only)', 'split', ['08:00', '12:00', '17:00'], { worked: 240, late: 240, flags: ['missing_break_in'] }, 'The afternoon cannot be proven without the break-in, so the whole second part (4h) is counted late. Flagged "No break-in punch". HR can add the tap to restore it.'),
	L('A6', 'split', 'In only — no other punch', 'split', ['08:00'], { worked: 0, flags: ['single_punch'] }, 'One punch is not a day. Worked 0, never counted late, and the rostered day is treated as absent until a clock-out is added by HR.'),
	L('A7', 'split', 'Out only — clock-in missing', 'split', ['17:00'], { worked: 0, flags: ['single_punch', 'missing_in'] }, 'A lone punch late in the day is a clock-out with no clock-in. It is not counted 9h late. Worked 0, absent until HR adds the clock-in.'),
	L('A8', 'split', 'Went to lunch and never came back', 'split', ['08:00', '12:00'], { worked: 240, under: 240, flags: ['no_return'] }, 'Only the morning counts. The afternoon is undertime. Flagged "No return from break".'),
	L('A9', 'split', 'Back from lunch but no clock-out', 'split', ['08:00', '12:00', '13:00'], { worked: 240, under: 240, flags: ['missing_out'] }, 'The afternoon cannot be proven, so it is charged as undertime until HR adds the clock-out. Flagged "No clock-out punch".'),
	L('A10', 'split', 'Early out in the morning (10:00 instead of 12:00)', 'split', ['08:00', '10:00'], { worked: 120, under: 360, flags: ['no_return'] }, '2h worked, and 6h undertime: the rest of the paid day (the unpaid lunch hour is not charged).'),
	L('A11', 'split', 'Four punches, leaves at 2:30 PM', 'split', ['08:00', '12:00', '13:00', '14:30'], { worked: 330, under: 150 }, 'A punch an hour or more after coming back is the clock-out. It is no longer mistaken for a second break-in.'),
	L('A12', 'split', 'Four punches, leaves at 3:30 PM', 'split', ['08:00', '12:00', '13:00', '15:30'], { worked: 390, under: 90 }, '1h30 undertime.'),
	L('A13', 'split', 'In at 8:00, one more punch at 1:00 PM', 'split', ['08:00', '13:00'], { worked: 240, under: 240, flags: ['missing_out'] }, 'The 1:00 PM punch is read as coming back from lunch, so there is no clock-out. The afternoon is charged as undertime until HR fixes it.'),
	L('A14', 'split', 'Arrives at 1:00 PM (morning off)', 'split', ['13:00', '17:00'], { worked: 240, late: 240 }, 'The lunch hour is not counted as worked or as late: 4h worked + 4h late = 8h. With an AM half-day leave the lateness is excused (see E3).'),
	L('A15', 'split', 'Double tap after lunch (1:00 and 1:10)', 'split', ['08:00', '12:00', '13:00', '13:10', '17:00'], { worked: 480 }, 'A second tap within the hour after coming back is a re-tap and is ignored; it never lengthens the break.'),
	L('A16', 'split', 'Back from lunch 30 min late (1:30)', 'split', ['08:00', '12:00', '13:30', '17:00'], { worked: 450, late: 30 }, 'The overrun is lateness.'),

	// ---- B. straight shift, no break window ----
	L('B1', 'plain', 'Perfect day', 'plain', ['08:00', '17:00'], { worked: 480 }, '9h in the building, 1h unpaid break: 8h.'),
	L('B2', 'plain', 'Late in (8:12)', 'plain', ['08:12', '17:00'], { worked: 468, late: 12 }, '12 min late.'),
	L('B3', 'plain', 'In only', 'plain', ['08:00'], { worked: 0, flags: ['single_punch'] }, 'One punch only: worked 0, absent until HR adds a clock-out.'),
	L('B4', 'plain', 'Out only', 'plain', ['17:00'], { worked: 0, flags: ['single_punch', 'missing_in'] }, 'Clock-in missing: worked 0, not counted late, absent until HR adds the clock-in.'),
	L('B5', 'plain', 'Early out at 10:00', 'plain', ['08:00', '10:00'], { worked: 120, under: 360 }, 'The unpaid break sits mid-shift, so it is only deducted if it was reached: 2h worked + 6h undertime = 8h.'),
	L('B6', 'plain', 'Leaves at 2:00 PM', 'plain', ['08:00', '14:00'], { worked: 300, under: 180 }, 'The break was already taken: 5h worked, 3h undertime.'),
	L('B7', 'plain', 'Lunch taps on a straight shift', 'plain', ['08:00', '12:00', '13:00', '17:00'], { worked: 480 }, 'No break window is set, so the middle taps are not needed: first and last punch are in and out.'),

	// ---- C. night ----
	L('C1', 'night', 'Complete night shift', 'night', ['22:00', '02:00+1', '03:00+1', '06:00+1'], { worked: 420, night: 420 }, 'Counted on the day it started. Night differential covers the hours inside 10 PM–6 AM, less the break.'),
	L('C2', 'night', 'In only', 'night', ['22:00'], { worked: 0, flags: ['single_punch'] }, 'One punch only: worked 0, absent until HR adds the rest.'),
	L('C3', 'night', 'Late in (10:20 PM)', 'night', ['22:20', '02:00+1', '03:00+1', '06:00+1'], { worked: 400, late: 20, night: 400 }, '20 min late; night differential covers only the time worked.'),

	// ---- D. overtime ----
	L('D1', 'overtime', 'Overtime filed and approved, punched out on time', 'split', ['08:00', '12:00', '13:00', '19:00'], { worked: 600, ot: 120 }, 'OT application 5:00–7:00 PM approved, out at 7:00 PM: 2h overtime is paid.', { approvedOt: ['17:00-19:00'] }),
	L('D2', 'overtime', 'Stayed past the approved overtime', 'split', ['08:00', '12:00', '13:00', '20:00'], { worked: 660, ot: 120, unapprovedOt: 60 }, 'Only the approved 2h is paid. The extra hour is flagged for HR and not paid.', { approvedOt: ['17:00-19:00'] }),
	L('D3', 'overtime', 'Worked late with no application', 'split', ['08:00', '12:00', '13:00', '19:00'], { worked: 600, ot: 0, unapprovedOt: 120 }, 'Nothing was filed, so nothing is paid. The 2h shows as unapproved overtime for HR.'),
	L('D4', 'overtime', 'Approved for two hours, left after one', 'split', ['08:00', '12:00', '13:00', '18:00'], { worked: 540, ot: 60 }, 'Overtime is what was actually worked inside the approved range.', { approvedOt: ['17:00-19:00'] }),
	L('D5', 'overtime', 'Approved overtime but left at 5:00 PM', 'split', ['08:00', '12:00', '13:00', '17:00'], { worked: 480, ot: 0 }, 'The application is not used if they did not stay. No pay.', { approvedOt: ['17:00-19:00'] }),
	L('D6', 'overtime', 'Approved overtime, no clock-out', 'split', ['08:00', '12:00', '13:00'], { worked: 240, under: 240, flags: ['missing_out'] }, 'No clock-out, so overtime cannot be proven. Add the out punch and the overtime is credited.', { approvedOt: ['17:00-19:00'] }),
	L('D7', 'overtime', 'Approved overtime before the shift (7:00–8:00)', 'split', ['07:00', '12:00', '13:00', '17:00'], { worked: 540, ot: 0 }, 'Limit: overtime is only counted after the scheduled end. The extra hour is in "worked" but not paid as overtime.', { approvedOt: ['07:00-08:00'] }),
	L('D8', 'overtime', 'Late in and staying for approved overtime', 'split', ['08:30', '12:00', '13:00', '19:00'], { worked: 570, late: 30, ot: 120 }, 'Lateness and overtime are separate: 30 min late is deducted, 2h overtime is paid.', { approvedOt: ['17:00-19:00'] }),
	L('D9', 'overtime', 'Stayed 2h, approved only the second half hour-block', 'split', ['08:00', '12:00', '13:00', '19:00'], { worked: 600, ot: 60, unapprovedOt: 60 }, 'Only the time that falls inside the approved range counts.', { approvedOt: ['17:30-18:30'] }),
	L('D10', 'overtime', 'Overtime past midnight', 'split', ['08:00', '12:00', '13:00', '01:00+1'], { worked: 960, ot: 480, flags: ['long_shift'] }, 'An approved range of 5:00 PM–1:00 AM is honoured. Flagged because the day is over 16h; check the out punch.', { approvedOt: ['17:00-01:00'] }),

	L('D11', 'overtime', '13-hour day with lunch taps', 'split', ['08:00', '12:00', '13:00', '21:00'], { worked: 720, ot: 240 }, 'A long day stays one shift. The 4h past 5:00 PM is overtime if approved. Without the lunch taps the day would be absent (see A3).', { approvedOt: ['17:00-21:00'] }),

	// ---- E. leave, holiday, memo ----
	L('E1', 'leave', 'Paid leave, whole day', 'split', [], { worked: 480, leaveCredit: 480 }, 'The shift is credited as paid. No absence.', { leave: { paid: true, halfDay: null } }),
	L('E2', 'leave', 'Unpaid leave, whole day', 'split', [], { worked: 0, leaveCredit: 0 }, 'Covered, so not an absence on the record, but nothing is credited.', { leave: { paid: false, halfDay: null } }),
	L('E3', 'leave', 'Morning half-day leave, arrives 1:00 PM', 'split', ['13:00', '17:00'], { worked: 480, leaveCredit: 240 }, 'The leave covers the morning: the late arrival is excused and the half day is credited.', { leave: { paid: true, halfDay: 'am' } }),
	L('E4', 'leave', 'Afternoon half-day leave, out at 12:00', 'split', ['08:00', '12:00'], { worked: 480, leaveCredit: 240 }, 'The leave covers the afternoon: no undertime and the half day is credited.', { leave: { paid: true, halfDay: 'pm' } }),
	L('E5', 'leave', 'Half-day leave, no punches at all', 'split', [], { worked: 240, leaveCredit: 240 }, 'Half the shift is credited; the other half has no punches, so HR should check it.', { leave: { paid: true, halfDay: 'am' } }),
	L('E6', 'leave', 'Holiday, did not work', 'split', [], { worked: 480 }, 'A holiday credits the scheduled day.', { memo: { creditHours: null, waiveLateness: false } }),
	L('E7', 'leave', 'Memo: half-day credit, left at 12:00', 'split', ['08:00', '12:00'], { worked: 240 }, 'Memo credits 4h and waives late/undertime, so leaving at noon costs nothing.', { memo: { creditHours: 4, waiveLateness: true } }),
	L('E8', 'leave', 'Memo waiving lateness, arrives 9:00', 'split', ['09:00', '12:00', '13:00', '17:00'], { worked: 480 }, 'Memo credits the day and waives the 60 min lateness.', { memo: { creditHours: null, waiveLateness: true } }),
	L('E9', 'leave', 'Memo without waiver, arrives 9:00', 'split', ['09:00', '12:00', '13:00', '17:00'], { worked: 420, late: 60 }, 'Only credit of 4h is given; they worked more than that and are still late.', { memo: { creditHours: 4, waiveLateness: false } }),

	// ---- F. absence and unscheduled work ----
	L('F1', 'absence', 'Rostered working day, no punches, no leave', 'split', [], { worked: 0, absent: true }, 'Absent. The day comes off the pay.'),
	L('F2', 'absence', 'Rest day, no punches', 'rest', [], { worked: 0 }, 'Nothing to record.'),
	L('F3', 'absence', 'Worked on their rest day', 'rest', ['08:00', '17:00'], { worked: 540, flags: ['rest_day'] }, 'All the time between in and out is recorded (no break is deducted on a rest day) and flagged; payroll applies the rest-day premium to the first 8h.'),
	L('F4', 'absence', 'Punches but no schedule that day', 'none', ['08:00', '17:00'], { worked: 540, flags: ['no_schedule'] }, 'Worked time only; late, undertime and overtime cannot be known. Roster the day, or HR reviews it.')
];

// ---------------------------------------------------------------------------

const toMs = (t: string, date = SAMPLE_DATE): number => {
	const next = t.endsWith('+1');
	const hhmm = next ? t.slice(0, -2) : t;
	const [y, m, d] = date.split('-').map(Number);
	const [h, mi] = hhmm.split(':').map(Number);
	return Date.UTC(y!, m! - 1, d! + (next ? 1 : 0), h!, mi!);
};

export interface Evaluated {
	worked: number;
	late: number;
	under: number;
	ot: number;
	unapprovedOt: number;
	night: number;
	flags: DtrFlag[];
	absent: boolean;
	leaveCredit: number;
	remarks: string;
	/** What payroll does with this day for a monthly-paid person. */
	pay: 'full' | 'late_undertime' | 'absent' | 'covered' | 'none';
}

/** Runs one scenario through the real engine, exactly as the DTR page builds a day. */
export function evaluate(sc: Scenario): Evaluated {
	const def = SCHEDULES[sc.schedule];
	const rest = !!def.rest;
	const schedule: ScheduleInput | null =
		sc.schedule === 'none'
			? null
			: rest
				? { isRestDay: true, startMs: null, endMs: null, breakMinutes: 0 }
				: {
						isRestDay: false,
						startMs: toMs(def.start!),
						endMs: toMs(def.end!),
						breakMinutes: def.breakMinutes ?? 0,
						breakStartMs: def.breakStart ? toMs(def.breakStart) : null,
						breakEndMs: def.breakEnd ? toMs(def.breakEnd) : null
					};
	const scheduledMinutes = rest || !def.start ? 480 : Math.max(0, (toMs(def.end!) - toMs(def.start)) / 60_000 - (def.breakMinutes ?? 0));

	const win = nightWindowParts(DEFAULT_NIGHT_WINDOW);
	const hhmmss = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
	const nightWindows: Array<[number, number]> = [-1, 0, 1].map((offset) => {
		const day = (o: number) => {
			const [y, m, d] = SAMPLE_DATE.split('-').map(Number);
			return new Date(Date.UTC(y!, m! - 1, d! + o));
		};
		const at = (o: number, hhmm: string) => {
			const dt = day(o);
			const [h, mi] = hhmm.split(':').map(Number);
			return Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), h!, mi!);
		};
		return [at(offset, hhmmss(win.start)), at(win.overnight ? offset + 1 : offset, hhmmss(win.end))];
	});

	let worked = 0, late = 0, under = 0, ot = 0, unapprovedOt = 0, night = 0;
	let flags: DtrFlag[] = [];
	let punched = false;
	if (sc.punches.length > 0) {
		punched = true;
		const cluster = clusterPunches(sc.punches.map((t) => toMs(t)), schedule?.startMs != null ? [schedule.startMs] : [])[0]!;
		const r = computeMetrics(cluster, schedule, nightWindows);
		({ workedMinutes: worked, tardinessMinutes: late, undertimeMinutes: under, otMinutes: ot, nightDiffMinutes: night } = r.metrics);
		flags = r.flags;
		if (ot > 0 && schedule?.endMs != null) {
			const ranges = (sc.approvedOt ?? []).map((r2) => {
				const [a, b] = r2.split('-') as [string, string];
				const s0 = timeToMinutes(a)!;
				const e0 = timeToMinutes(b)!;
				return [toMs(a), toMs(e0 <= s0 ? `${b}+1` : b)] as [number, number];
			});
			const credit = creditOvertime([schedule.endMs, schedule.endMs + ot * 60_000], ranges);
			ot = credit.approvedMinutes;
			unapprovedOt = credit.unapprovedMinutes;
		}
	}

	let leaveCredit = 0;
	const lv = sc.leave ?? null;
	const cal = sc.memo ?? null;
	const covered = !!lv || !!cal;
	if (!punched && !covered) {
		const scheduledDay = !rest && sc.schedule !== 'none';
		return { worked: 0, late: 0, under: 0, ot: 0, unapprovedOt: 0, night: 0, flags: [], absent: scheduledDay, leaveCredit: 0, remarks: scheduledDay ? 'Absent' : '', pay: scheduledDay ? 'absent' : 'none' };
	}
	if (covered) {
		const a = applyCredits(
			{ worked, late, under, ot, night },
			scheduledMinutes,
			lv ? { paid: lv.paid, halfDay: lv.halfDay } : null,
			cal ? { creditMinutes: cal.creditHours === null ? null : Math.round(cal.creditHours * 60), waiveLateness: cal.waiveLateness } : null,
			punched
		);
		flags = a.clearPunches ? [] : flagsAfterCredit(flags, under, a.under);
		({ worked, late, under, ot, night } = a);
		leaveCredit = a.leaveMinutes;
	}
	const remarks = recordRemarks({
		isAbsent: false,
		flags,
		manualPunch: false,
		timeIn: punched ? 1 : null,
		leave: lv ? { code: 'LV', name: 'Leave', halfDay: lv.halfDay } : null,
		calendar: cal ? { name: 'Holiday / memo' } : null
	});
	const scheduled = !rest && sc.schedule !== 'none';
	const pay: Evaluated['pay'] =
		scheduled && worked === 0 && !punched && !covered
			? 'absent'
			: scheduled && worked === 0
				? 'absent'
				: late > 0 || under > 0
					? 'late_undertime'
					: covered && !punched
						? 'covered'
						: 'full';
	return { worked, late, under, ot, unapprovedOt, night, flags, absent: false, leaveCredit, remarks, pay };
}

export const GROUP_TITLES: Record<Scenario['group'], { title: string; blurb: string }> = {
	split: {
		title: 'Split shift with a lunch break',
		blurb: 'A schedule with a break window, e.g. 8:00 AM–12:00 PM then 1:00 PM–5:00 PM. Punches are read as in, break-out, break-in, out.'
	},
	plain: {
		title: 'Straight shift (no break window)',
		blurb: 'A schedule with an unpaid break length but no break times. The first punch is in and the last is out; the break is assumed in the middle of the shift.'
	},
	night: { title: 'Night shift', blurb: 'A shift that crosses midnight is counted on the day it started.' },
	overtime: {
		title: 'Overtime',
		blurb: 'Overtime is time punched after the scheduled end. It is paid only where an approved application covers it.'
	},
	leave: {
		title: 'Leave, holidays and memos',
		blurb: 'Approved leave and holiday/memo days cover the schedule and win over "absent". A staff-entered DTR row still wins over all.'
	},
	absence: { title: 'Absences and unscheduled work', blurb: 'Days with no punches, rest days, and days with no roster entry.' }
};
