import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { todayInTimezone } from '$lib/server/time';
import {
	ScheduleError,
	applyShiftToCells,
	cellRefSchema,
	cellShiftSchema,
	cellStateSchema,
	clearCells,
	copyWeek,
	listSchedules,
	restoreCells,
	MAX_CELLS_PER_EDIT
} from '$lib/server/hr/schedules';
import {
	ShiftTemplateError,
	addStarterTemplates,
	createShiftTemplate,
	deleteShiftTemplate,
	listShiftTemplates,
	shiftTemplateFormSchema,
	updateShiftTemplate
} from '$lib/server/hr/shift-templates';
import { listEmployees } from '$lib/server/hr/employees';
import { listCalendar } from '$lib/server/hr/calendar';
import { listLeaveDays } from '$lib/server/hr/leave';
import { parseNightDiff } from '$lib/server/hr/night-diff';
import { addDays, isDateString, mondayOf, weekDates } from '$lib/roster';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.access, 'schedule:*', locals.establishment!.id);
	const establishment = locals.establishment!;

	// "Today" is the establishment's business date, never the server's UTC clock.
	const today = todayInTimezone(establishment.timezone);
	const anchor = url.searchParams.get('week');
	const weekStart = mondayOf(anchor && isDateString(anchor) ? anchor : today);
	const weekEnd = addDays(weekStart, 6);

	const [entries, allEmployees, templates, previousWeek, leaveDays, calendar] = await Promise.all([
		listSchedules(establishment.id, weekStart, weekEnd),
		listEmployees(establishment.id),
		listShiftTemplates(establishment.id),
		listSchedules(establishment.id, addDays(weekStart, -7), addDays(weekStart, -1)),
		listLeaveDays(establishment.id, weekStart, weekEnd),
		listCalendar(establishment.id, weekStart, weekEnd)
	]);

	// A separated employee drops off the roster, unless they still hold shifts this week.
	const scheduled = new Set(entries.map((e) => e.employeeId));
	const rosterEmployees = allEmployees
		.filter((e) => e.status !== 'separated' || scheduled.has(e.id))
		.map((e) => ({
			id: e.id,
			firstName: e.firstName,
			lastName: e.lastName,
			position: e.position,
			department: e.department,
			status: e.status
		}));

	return {
		weekStart,
		weekEnd,
		days: weekDates(weekStart),
		today,
		entries,
		employees: rosterEmployees,
		templates,
		previousWeekShiftCount: previousWeek.length,
		/** Establishment-wide default night window, used by shifts that set none. */
		nightDiff: parseNightDiff(establishment.config),
		/** `employeeId|date` → leave covering that day (an overlay: the shift itself is untouched). */
		leave: Object.fromEntries(
			[...leaveDays].map(([key, l]) => [key, { code: l.code, name: l.name, half: l.halfDay }])
		),
		/** date → holiday / memo name. */
		calendar: Object.fromEntries(calendar.map((c) => [c.date, { name: c.name, kind: c.kind }]))
	};
};

const cellsField = z.array(cellRefSchema).min(1).max(MAX_CELLS_PER_EDIT);

function json(raw: FormDataEntryValue | null): unknown {
	if (typeof raw !== 'string') return undefined;
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

/** Maps the two expected, user-facing failures to a 400; anything else is a real bug and rethrows. */
function userFailure(e: unknown) {
	if (e instanceof ScheduleError || e instanceof ShiftTemplateError) {
		return fail(400, { error: e.message });
	}
	throw e;
}

export const actions: Actions = {
	/** Paint one shift/rest onto a set of cells. */
	applyShift: async (event) => {
		requireCap(event.locals.user, event.locals.access, 'schedule:*', event.locals.establishment!.id);
		const establishmentId = event.locals.establishment!.id;
		const fd = await event.request.formData();
		const cells = cellsField.safeParse(json(fd.get('cells')));
		const shift = cellShiftSchema.safeParse(json(fd.get('shift')));
		if (!cells.success || !shift.success) {
			return fail(400, {
				error: shift.error?.issues[0]?.message ?? 'Check the shift and try again.'
			});
		}
		try {
			const result = await applyShiftToCells(establishmentId, cells.data, shift.data);
			await writeAudit({
				establishmentId,
				actor: event.locals.user,
				action: 'schedule.apply',
				entityType: 'schedule',
				entityId: null,
				after: { cells: result.applied, shift: shift.data }
			});
			return { ok: true, applied: result.applied, undo: result.previous };
		} catch (e) {
			return userFailure(e);
		}
	},

	clear: async (event) => {
		requireCap(event.locals.user, event.locals.access, 'schedule:*', event.locals.establishment!.id);
		const establishmentId = event.locals.establishment!.id;
		const fd = await event.request.formData();
		const cells = cellsField.safeParse(json(fd.get('cells')));
		if (!cells.success) return fail(400, { error: 'Select at least one day to clear.' });
		try {
			const result = await clearCells(establishmentId, cells.data);
			if (result.cleared > 0) {
				await writeAudit({
					establishmentId,
					actor: event.locals.user,
					action: 'schedule.clear',
					entityType: 'schedule',
					entityId: null,
					after: { cells: result.cleared }
				});
			}
			return { ok: true, cleared: result.cleared, undo: result.previous };
		} catch (e) {
			return userFailure(e);
		}
	},

	copyWeek: async (event) => {
		requireCap(event.locals.user, event.locals.access, 'schedule:*', event.locals.establishment!.id);
		const establishmentId = event.locals.establishment!.id;
		const fd = await event.request.formData();
		const from = String(fd.get('from') ?? '');
		const to = String(fd.get('to') ?? '');
		if (!isDateString(from) || !isDateString(to))
			return fail(400, { error: 'Pick a week to copy.' });
		// Both ends are normalised to a Monday so a stray date can't copy a half-week offset.
		const fromMonday = mondayOf(from);
		const toMonday = mondayOf(to);
		try {
			const result = await copyWeek(establishmentId, fromMonday, toMonday, fd.get('overwrite') === '1');
			await writeAudit({
				establishmentId,
				actor: event.locals.user,
				action: 'schedule.copy_week',
				entityType: 'schedule',
				entityId: null,
				after: { from: fromMonday, to: toMonday, copied: result.copied, skipped: result.skipped }
			});
			return { ok: true, copied: result.copied, skipped: result.skipped, undo: result.previous };
		} catch (e) {
			return userFailure(e);
		}
	},

	undo: async (event) => {
		requireCap(event.locals.user, event.locals.access, 'schedule:*', event.locals.establishment!.id);
		const establishmentId = event.locals.establishment!.id;
		const fd = await event.request.formData();
		const states = z
			.array(cellStateSchema)
			.min(1)
			.max(MAX_CELLS_PER_EDIT)
			.safeParse(json(fd.get('states')));
		if (!states.success) return fail(400, { error: 'Nothing to undo.' });
		try {
			const result = await restoreCells(establishmentId, states.data);
			await writeAudit({
				establishmentId,
				actor: event.locals.user,
				action: 'schedule.undo',
				entityType: 'schedule',
				entityId: null,
				after: { cells: result.restored }
			});
			return { ok: true, undone: true };
		} catch (e) {
			return userFailure(e);
		}
	},

	saveTemplate: async (event) => {
		requireCap(event.locals.user, event.locals.access, 'schedule:*', event.locals.establishment!.id);
		const establishmentId = event.locals.establishment!.id;
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = shiftTemplateFormSchema.safeParse({
			...raw,
			isRestDay: raw.isRestDay === 'on' || raw.isRestDay === '1',
			startTime: raw.startTime || undefined,
			endTime: raw.endTime || undefined,
			breakStart: raw.breakStart || undefined,
			breakEnd: raw.breakEnd || undefined,
			nightStart: raw.nightStart || undefined,
			nightEnd: raw.nightEnd || undefined
		});
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the shift details.' });
		}
		const id = typeof raw.id === 'string' && raw.id ? raw.id : null;
		try {
			const row = id
				? await updateShiftTemplate(establishmentId, id, parsed.data)
				: await createShiftTemplate(establishmentId, parsed.data);
			await writeAudit({
				establishmentId,
				actor: event.locals.user,
				action: id ? 'shift_template.update' : 'shift_template.create',
				entityType: 'shift_template',
				entityId: row.id,
				after: parsed.data
			});
			return { templateOk: id ? 'Shift updated.' : 'Shift added.' };
		} catch (e) {
			return userFailure(e);
		}
	},

	deleteTemplate: async (event) => {
		requireCap(event.locals.user, event.locals.access, 'schedule:*', event.locals.establishment!.id);
		const establishmentId = event.locals.establishment!.id;
		const id = (await event.request.formData()).get('id');
		if (typeof id !== 'string' || !z.string().uuid().safeParse(id).success) {
			return fail(400, { error: 'Missing shift.' });
		}
		try {
			await deleteShiftTemplate(establishmentId, id);
			await writeAudit({
				establishmentId,
				actor: event.locals.user,
				action: 'shift_template.delete',
				entityType: 'shift_template',
				entityId: id
			});
			return { templateOk: 'Shift removed. Rosters already built from it are unchanged.' };
		} catch (e) {
			return userFailure(e);
		}
	},

	addStarterTemplates: async (event) => {
		requireCap(event.locals.user, event.locals.access, 'schedule:*', event.locals.establishment!.id);
		const establishmentId = event.locals.establishment!.id;
		try {
			const added = await addStarterTemplates(establishmentId);
			await writeAudit({
				establishmentId,
				actor: event.locals.user,
				action: 'shift_template.starter_set',
				entityType: 'shift_template',
				entityId: null,
				after: { added }
			});
			return {
				templateOk:
					added > 0
						? `Added ${added} starter shift${added === 1 ? '' : 's'}.`
						: 'Starter shifts are already there.'
			};
		} catch (e) {
			return userFailure(e);
		}
	}
};
