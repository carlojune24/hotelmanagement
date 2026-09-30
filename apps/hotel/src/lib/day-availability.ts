/** Per-night availability for the guest date picker. Pure — shared by the server loader and
 *  the calendar component. A "night" is keyed by its start date: night D = the stay from D to
 *  D+1, so a guest checking out on D does not use night D. */

/** A room type with this many rooms free or fewer (but more than zero) reads as "few left". */
export const FEW_LEFT_ROOMS = 2;

export type DayStatus = 'free' | 'few' | 'full';

export interface DayAvailability {
	/** YYYY-MM-DD — the night starting this date. */
	date: string;
	status: DayStatus;
	/** Rooms still free across every room type that night. */
	roomsLeft: number;
}

export interface CalendarRoomType {
	id: string;
	totalRooms: number;
}

export interface CalendarBooking {
	roomTypeId: string;
	checkIn: string;
	checkOut: string;
	quantity: number;
}

const DAY_MS = 86_400_000;

/** Adds days to a YYYY-MM-DD string. UTC math, so DST and the machine timezone never shift it. */
export function addDays(iso: string, n: number): string {
	return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * One entry per night for `days` nights from `from`. A night is `full` when no room type has a
 * room free, `few` when the room type with the most rooms free still has only `FEW_LEFT_ROOMS`
 * or fewer (the hotel is nearly out), and `free` otherwise.
 */
export function computeDayAvailability(
	types: CalendarRoomType[],
	bookings: CalendarBooking[],
	from: string,
	days: number
): DayAvailability[] {
	const out: DayAvailability[] = [];
	for (let i = 0; i < days; i++) {
		const date = addDays(from, i);
		let roomsLeft = 0;
		let bestType = 0;
		for (const t of types) {
			const held = bookings
				.filter((b) => b.roomTypeId === t.id && b.checkIn <= date && date < b.checkOut)
				.reduce((sum, b) => sum + b.quantity, 0);
			const left = Math.max(0, t.totalRooms - held);
			roomsLeft += left;
			bestType = Math.max(bestType, left);
		}
		out.push({
			date,
			roomsLeft,
			status: roomsLeft === 0 ? 'full' : bestType <= FEW_LEFT_ROOMS ? 'few' : 'free'
		});
	}
	return out;
}

/** True when every night in `[checkIn, checkOut)` is bookable — used to stop a guest picking a
 *  range that spans a sold-out night. Dates outside the loaded window count as bookable. */
export function nightsAreFree(
	status: ReadonlyMap<string, DayStatus>,
	checkIn: string,
	checkOut: string
): boolean {
	for (let d = checkIn; d < checkOut; d = addDays(d, 1)) {
		if (status.get(d) === 'full') return false;
	}
	return true;
}

/** How many rooms of one type are free on a given night — for the room cards' stock line. */
export function roomsLeftForType(
	type: CalendarRoomType,
	bookings: CalendarBooking[],
	date: string
): number {
	const held = bookings
		.filter((b) => b.roomTypeId === type.id && b.checkIn <= date && date < b.checkOut)
		.reduce((sum, b) => sum + b.quantity, 0);
	return Math.max(0, type.totalRooms - held);
}
