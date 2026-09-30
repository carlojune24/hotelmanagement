import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { requireCap } from '$lib/server/auth/rbac';
import { db } from '$lib/server/db/index';
import { hotels } from '$lib/server/db/schema/index';
import { todayInTimezone } from '$lib/server/front-desk';
import { listEmployees } from '$lib/server/hr/employees';
import { listSchedules } from '$lib/server/hr/schedules';
import { listShiftTemplates } from '$lib/server/hr/shift-templates';
import {
	addDays,
	buildShiftLegend,
	datesBetween,
	isDateString,
	mondayOf,
	monthBounds,
	weekDates
} from '$lib/roster';
import type { PageServerLoad } from './$types';

export type PrintView = 'week' | 'month' | 'employee';
export type PrintPeriod = 'week' | 'month';

/**
 * Staff-only printed roster. `view=week|month` is the whole team on one landscape grid;
 * `view=employee` is one portrait sheet per person (`employee=<id>` for one, omitted for
 * everyone) covering `period=week|month`. `date` is any day in the wanted week/month.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'schedule:*');
	const hotel = locals.hotel!;

	const viewParam = url.searchParams.get('view');
	const view: PrintView = viewParam === 'month' || viewParam === 'employee' ? viewParam : 'week';
	const periodParam = url.searchParams.get('period');
	const period: PrintPeriod = periodParam === 'week' ? 'week' : 'month';
	const dateParam = url.searchParams.get('date');
	const date = dateParam && isDateString(dateParam) ? dateParam : todayInTimezone(hotel.timezone);

	// What span the sheet covers: a week, or a calendar month.
	const span: PrintPeriod = view === 'employee' ? period : view;
	const weekStart = mondayOf(date);
	const range =
		span === 'week' ? { start: weekStart, end: addDays(weekStart, 6) } : monthBounds(date);

	const employeeParam = url.searchParams.get('employee');
	const [hotelRow, allEmployees, entries, templates] = await Promise.all([
		db
			.select({
				name: hotels.name,
				legalName: hotels.legalName,
				addressLine: hotels.addressLine,
				city: hotels.city
			})
			.from(hotels)
			.where(eq(hotels.id, hotel.id))
			.limit(1)
			.then((r) => r[0]),
		listEmployees(hotel.id),
		listSchedules(hotel.id, range.start, range.end),
		listShiftTemplates(hotel.id)
	]);

	// Same roster rule as the schedule page: separated staff only appear if they still hold shifts.
	const scheduled = new Set(entries.map((e) => e.employeeId));
	let employees = allEmployees
		.filter((e) => e.status !== 'separated' || scheduled.has(e.id))
		.map((e) => ({
			id: e.id,
			firstName: e.firstName,
			lastName: e.lastName,
			position: e.position,
			department: e.department,
			employeeNo: e.employeeNo,
			status: e.status
		}));

	if (view === 'employee' && employeeParam) {
		employees = employees.filter((e) => e.id === employeeParam);
		if (employees.length === 0) error(404, 'Employee not found');
	}

	const legend = buildShiftLegend(
		entries.map((e) => ({
			isRestDay: e.isRestDay,
			startTime: e.startTime,
			endTime: e.endTime,
			breakMinutes: e.breakMinutes
		})),
		templates
	);

	return {
		view,
		period,
		span,
		range,
		days: span === 'week' ? weekDates(weekStart) : datesBetween(range.start, range.end),
		employees,
		entries: entries.filter((e) => employees.some((emp) => emp.id === e.employeeId)),
		legend,
		hotel: {
			name: hotelRow?.name ?? hotel.name,
			legalName: hotelRow?.legalName ?? null,
			address: [hotelRow?.addressLine, hotelRow?.city].filter(Boolean).join(', ') || null
		},
		// Screen-only picker on the page; the printout never shows it.
		pickerEmployees: allEmployees.map((e) => ({
			id: e.id,
			name: `${e.firstName} ${e.lastName}`
		})),
		selectedEmployeeId: view === 'employee' ? employeeParam : null,
		date,
		printedAt: new Date().toLocaleString('en-PH', {
			dateStyle: 'medium',
			timeStyle: 'short',
			timeZone: hotel.timezone
		})
	};
};
