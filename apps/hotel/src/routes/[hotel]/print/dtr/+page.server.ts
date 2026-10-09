import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { requireCap } from '$lib/server/auth/rbac';
import { db } from '$lib/server/db/index';
import { hotels } from '$lib/server/db/schema/index';
import { businessDateFor } from '$lib/server/finance/shared';
import { listDtrEntries } from '$lib/server/hr/dtr';
import { monthSchema } from '$lib/server/hr/dtr-import';
import { buildDtrDays, recordFromSaved, type DtrDay, type DtrTotals } from '$lib/server/hr/dtr-view';
import { listEmployees } from '$lib/server/hr/employees';
import { listSchedules } from '$lib/server/hr/schedules';
import { monthBounds } from '$lib/roster';
import type { PageServerLoad } from './$types';

export type DtrSheet = {
	employee: { name: string; position: string };
	days: DtrDay[];
	totals: DtrTotals;
};

/**
 * Staff-only printed DTR, from the **saved** record so the paper always matches what payroll
 * reads. One sheet per employee for a calendar month, printed twice side by side (one copy for
 * the employee, one for the file). `employee=<id>` for one person; omitted for everyone who has
 * a saved month. Late, undertime and absences only for now.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'dtr:*');
	const hotel = locals.hotel!;

	const monthParam = url.searchParams.get('month');
	const month =
		monthParam && monthSchema.safeParse(monthParam).success
			? monthParam
			: businessDateFor(hotel.timezone).slice(0, 7);
	const employeeParam = url.searchParams.get('employee');
	const range = monthBounds(`${month}-01`);

	const [hotelRow, allEmployees, entries, roster] = await Promise.all([
		db
			.select({ name: hotels.name, legalName: hotels.legalName })
			.from(hotels)
			.where(eq(hotels.id, hotel.id))
			.limit(1)
			.then((r) => r[0]),
		listEmployees(hotel.id),
		listDtrEntries(hotel.id, range.start, range.end),
		listSchedules(hotel.id, range.start, range.end)
	]);

	const withRecords = new Set(entries.map((e) => e.employeeId));
	const people = employeeParam
		? allEmployees.filter((e) => e.id === employeeParam)
		: allEmployees.filter((e) => withRecords.has(e.id));
	if (employeeParam && people.length === 0) error(404, 'Employee not found');
	people.sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));

	const sheets: DtrSheet[] = people.map((emp) => {
		const { days, totals } = buildDtrDays({
			tz: hotel.timezone,
			range,
			roster: roster.filter((s) => s.employeeId === emp.id),
			records: new Map(entries.filter((e) => e.employeeId === emp.id).map((e) => [e.date, recordFromSaved(e)]))
		});
		return {
			employee: { name: `${emp.lastName}, ${emp.firstName}`, position: emp.position },
			days,
			totals
		};
	});

	return {
		month,
		sheets,
		selectedEmployeeId: employeeParam || null,
		pickerEmployees: allEmployees
			.filter((e) => e.biometricEnrollId)
			.map((e) => ({ id: e.id, name: `${e.lastName}, ${e.firstName}` }))
			.sort((a, b) => a.name.localeCompare(b.name)),
		hotel: { name: hotelRow?.legalName ?? hotelRow?.name ?? hotel.name }
	};
};
