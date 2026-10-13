/**
 * Premium-pay multipliers (DOLE rules on regular days, rest days and holidays), as a multiple of
 * the hourly rate:
 *
 * - `WORKED` — total pay for each of the first 8 hours worked that day (100% is ordinary basic
 *   pay; the premium is the excess over 1).
 * - `OVERTIME` — pay per overtime hour: the day's rate plus 30% of it (ordinary day: 125%).
 *
 * "Special" holidays are the special non-working days; a locally declared holiday is treated as
 * one. A regular holiday on a rest day carries the combined premium. Memos change nothing here.
 *
 * ⚠ Encoded from the DOLE handbook; Main HR confirms them at each lock.
 */
export type DayKind =
	| 'ordinary'
	| 'rest_day'
	| 'special_holiday'
	| 'special_holiday_rest'
	| 'regular_holiday'
	| 'regular_holiday_rest';

export const WORKED_MULTIPLIER: Record<DayKind, number> = {
	ordinary: 1,
	rest_day: 1.3,
	special_holiday: 1.3,
	special_holiday_rest: 1.5,
	regular_holiday: 2,
	regular_holiday_rest: 2.6
};

export const OVERTIME_MULTIPLIER: Record<DayKind, number> = {
	ordinary: 1.25,
	rest_day: 1.69,
	special_holiday: 1.69,
	special_holiday_rest: 1.95,
	regular_holiday: 2.6,
	regular_holiday_rest: 3.38
};

/** Classifies a date from whether it is a rest day and what, if any, holiday it is. */
export function dayKindOf(input: {
	isRestDay: boolean;
	/** `calendar_days.kind`: regular_holiday | special_holiday | local_holiday | memo | null */
	holiday: string | null;
}): DayKind {
	const regular = input.holiday === 'regular_holiday';
	const special = input.holiday === 'special_holiday' || input.holiday === 'local_holiday';
	if (regular) return input.isRestDay ? 'regular_holiday_rest' : 'regular_holiday';
	if (special) return input.isRestDay ? 'special_holiday_rest' : 'special_holiday';
	return input.isRestDay ? 'rest_day' : 'ordinary';
}
