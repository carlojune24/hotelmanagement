import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { businessDateFor } from '$lib/server/finance/shared';
import {
	CalendarError,
	calendarFormSchema,
	deleteCalendarDay,
	listCalendar,
	saveCalendarDay
} from '$lib/server/hr/calendar';
import {
	LeaveError,
	deleteLeaveType,
	leaveTypeSchema,
	listLeaveTypes,
	restoreStatutoryDefaults,
	saveLeaveType
} from '$lib/server/hr/leave';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'leave:*');
	const hotel = locals.hotel!;
	const yearParam = Number(url.searchParams.get('year'));
	const year =
		Number.isInteger(yearParam) && yearParam >= 2000 && yearParam <= 2100
			? yearParam
			: Number(businessDateFor(hotel.timezone).slice(0, 4));
	const [types, calendar] = await Promise.all([
		listLeaveTypes(hotel.id),
		listCalendar(hotel.id, `${year}-01-01`, `${year}-12-31`)
	]);
	return {
		year,
		types: types.map((t) => ({
			id: t.id,
			code: t.code,
			name: t.name,
			description: t.description ?? '',
			statutory: t.statutory,
			paid: t.paid,
			daysPerYear: t.daysPerYear,
			dayCount: t.dayCount as 'working' | 'calendar',
			minServiceMonths: t.minServiceMonths,
			employmentTypes: t.employmentTypes,
			sexRestriction: t.sexRestriction as 'male' | 'female' | null,
			halfDayAllowed: t.halfDayAllowed,
			carryOverDays: t.carryOverDays,
			cashConvertible: t.cashConvertible,
			requiresDocument: t.requiresDocument,
			active: t.active
		})),
		calendar: calendar.map((c) => ({
			id: c.id,
			date: c.date,
			name: c.name,
			kind: c.kind,
			creditMinutes: c.creditMinutes,
			waiveLateness: c.waiveLateness
		}))
	};
};

function typeFromForm(fd: FormData) {
	const sex = fd.get('sexRestriction');
	return leaveTypeSchema.safeParse({
		code: fd.get('code'),
		name: fd.get('name'),
		description: fd.get('description') ?? '',
		paid: fd.get('paid') === 'on',
		daysPerYear: fd.get('daysPerYear'),
		dayCount: fd.get('dayCount'),
		minServiceMonths: fd.get('minServiceMonths') || 0,
		employmentTypes: fd.getAll('employmentTypes'),
		sexRestriction: sex === 'male' || sex === 'female' ? sex : null,
		halfDayAllowed: fd.get('halfDayAllowed') === 'on',
		carryOverDays: fd.get('carryOverDays') || 0,
		cashConvertible: fd.get('cashConvertible') === 'on',
		requiresDocument: fd.get('requiresDocument') === 'on',
		active: fd.get('active') === 'on'
	});
}

export const actions: Actions = {
	saveType: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'leave:*');
		try {
			const hotelId = event.locals.hotel!.id;
			const fd = await event.request.formData();
			const parsed = typeFromForm(fd);
			if (!parsed.success) return fail(400, { error: parsed.error.issues[0]!.message });
			const id = fd.get('id');
			const { before, after } = await saveLeaveType(
				hotelId,
				parsed.data,
				typeof id === 'string' && id ? id : undefined
			);
			await writeAudit({
				hotelId,
				actor: event.locals.user,
				action: before ? 'leave.type_update' : 'leave.type_create',
				entityType: 'leave_type',
				entityId: after.id,
				before: before ?? undefined,
				after
			});
			return { ok: before ? `${after.name} updated.` : `${after.name} added.` };
		} catch (e) {
			if (e instanceof LeaveError) return fail(400, { error: e.message });
			throw e;
		}
	},

	deleteType: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'leave:*');
		try {
			const hotelId = event.locals.hotel!.id;
			const id = z.string().uuid().safeParse((await event.request.formData()).get('id'));
			if (!id.success) return fail(400, { error: 'Missing leave.' });
			await deleteLeaveType(hotelId, id.data);
			await writeAudit({
				hotelId,
				actor: event.locals.user,
				action: 'leave.type_delete',
				entityType: 'leave_type',
				entityId: id.data
			});
			return { ok: 'Leave deleted.' };
		} catch (e) {
			if (e instanceof LeaveError) return fail(400, { error: e.message });
			throw e;
		}
	},

	restoreDefaults: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'leave:*');
		const hotelId = event.locals.hotel!.id;
		await restoreStatutoryDefaults(hotelId);
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'leave.restore_defaults',
			entityType: 'leave_type',
			entityId: null
		});
		return { ok: 'Statutory leaves are back to the legal defaults.' };
	},

	saveDay: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'leave:*');
		try {
			const hotelId = event.locals.hotel!.id;
			const fd = await event.request.formData();
			const parsed = calendarFormSchema.safeParse({
				date: fd.get('date'),
				name: fd.get('name'),
				kind: fd.get('kind'),
				creditHours: fd.get('creditHours'),
				waiveLateness: fd.get('waiveLateness') === 'on'
			});
			if (!parsed.success) return fail(400, { error: parsed.error.issues[0]!.message });
			const id = fd.get('id');
			const row = await saveCalendarDay(hotelId, parsed.data, typeof id === 'string' && id ? id : undefined);
			await writeAudit({
				hotelId,
				actor: event.locals.user,
				action: id ? 'calendar.update' : 'calendar.create',
				entityType: 'calendar_day',
				entityId: row.id,
				after: row
			});
			return { ok: `${row.name} saved. Save the month's DTR again to carry it over.` };
		} catch (e) {
			if (e instanceof CalendarError) return fail(400, { error: e.message });
			throw e;
		}
	},

	deleteDay: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'leave:*');
		const hotelId = event.locals.hotel!.id;
		const id = z.string().uuid().safeParse((await event.request.formData()).get('id'));
		if (!id.success) return fail(400, { error: 'Missing day.' });
		await deleteCalendarDay(hotelId, id.data);
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'calendar.delete',
			entityType: 'calendar_day',
			entityId: id.data
		});
		return { ok: 'Removed from the calendar.' };
	}
};
