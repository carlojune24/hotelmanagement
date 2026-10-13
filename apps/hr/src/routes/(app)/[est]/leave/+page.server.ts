import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { canAt } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { businessDateFor } from '$lib/server/time';
import { listEmployees } from '$lib/server/hr/employees';
import { CalendarError, calendarFormSchema, proposeCalendarDay } from '$lib/server/hr/calendar';
import {
	LeaveError,
	cancelLeave,
	fileLeave,
	leaveFormSchema,
	listLeaveRequests,
	listLeaveTypes,
	previewLeave
} from '$lib/server/hr/leave';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.access, 'leave:file', locals.establishment!.id);
	const establishment = locals.establishment!;
	const yearParam = Number(url.searchParams.get('year'));
	const year =
		Number.isInteger(yearParam) && yearParam >= 2000 && yearParam <= 2100
			? yearParam
			: Number(businessDateFor(establishment.timezone).slice(0, 4));

	const [requests, types, employees] = await Promise.all([
		listLeaveRequests(establishment.id, year),
		listLeaveTypes(establishment.id),
		listEmployees(establishment.id)
	]);
	return {
		year,
		/** Main HR files and approves in one step; everyone else sends it for approval. */
		canApprove: isApprover(locals),
		canProposeMemo: locals.user!.isSystemAdmin || canAt(locals.access!, 'memo:propose', establishment.id),
		today: businessDateFor(establishment.timezone),
		requests,
		types: types
			.filter((t) => t.active)
			.map((t) => ({
				id: t.id,
				code: t.code,
				name: t.name,
				paid: t.paid,
				halfDayAllowed: t.halfDayAllowed,
				requiresDocument: t.requiresDocument,
				dayCount: t.dayCount
			})),
		employees: employees
			.filter((e) => e.status !== 'separated')
			.map((e) => ({ id: e.id, name: `${e.lastName}, ${e.firstName}` }))
	};
};

function parseForm(fd: FormData) {
	const half = fd.get('halfDay');
	return leaveFormSchema.safeParse({
		employeeId: fd.get('employeeId'),
		leaveTypeId: fd.get('leaveTypeId'),
		startDate: fd.get('startDate'),
		endDate: fd.get('endDate') || fd.get('startDate'),
		halfDay: half === 'am' || half === 'pm' ? half : null,
		reason: fd.get('reason') ?? '',
		documentNote: fd.get('documentNote') ?? ''
	});
}

function failure(e: unknown) {
	if (e instanceof LeaveError || e instanceof CalendarError) return fail(400, { error: e.message });
	throw e;
}

function isApprover(locals: App.Locals): boolean {
	return locals.user!.isSystemAdmin || canAt(locals.access!, 'approval:*', locals.establishment!.id);
}

export const actions: Actions = {
	/** What the request would count and leave behind, shown live in the dialog. Writes nothing. */
	preview: async (event) => {
		requireCap(event.locals.user, event.locals.access, 'leave:file', event.locals.establishment!.id);
		const parsed = parseForm(await event.request.formData());
		if (!parsed.success) return { preview: null, previewError: null };
		try {
			const p = await previewLeave(event.locals.establishment!.id, parsed.data);
			return {
				preview: {
					days: p.days,
					capped: p.capped,
					remaining: p.balance.remaining,
					after: p.after,
					paid: p.type.paid,
					requiresDocument: p.type.requiresDocument
				},
				previewError: null
			};
		} catch (e) {
			if (e instanceof LeaveError) return { preview: null, previewError: e.message };
			throw e;
		}
	},

	file: async (event) => {
		requireCap(event.locals.user, event.locals.access, 'leave:file', event.locals.establishment!.id);
		try {
			const establishmentId = event.locals.establishment!.id;
			const parsed = parseForm(await event.request.formData());
			if (!parsed.success) throw new LeaveError(parsed.error.issues[0]!.message);
			const approver = isApprover(event.locals);
			const r = await fileLeave(establishmentId, parsed.data, event.locals.user?.id ?? null, approver);
			await writeAudit({
				establishmentId,
				actor: event.locals.user,
				action: approver ? 'leave.file' : 'leave.submit',
				entityType: 'leave_request',
				entityId: r.request.id,
				after: {
					employeeId: r.emp.id,
					type: r.type.code,
					start: r.request.startDate,
					end: r.request.endDate,
					days: r.request.days,
					paid: r.request.paid
				}
			});
			const n = `${r.request.days} day${r.request.days === 1 ? '' : 's'}`;
			return {
				ok: approver
					? `${r.type.name} filed: ${n}. Save the month's DTR again to carry it over.`
					: `${r.type.name} (${n}) sent to Main HR for approval.`
			};
		} catch (e) {
			return failure(e);
		}
	},

	cancel: async (event) => {
		requireCap(event.locals.user, event.locals.access, 'leave:file', event.locals.establishment!.id);
		try {
			const establishmentId = event.locals.establishment!.id;
			const fd = await event.request.formData();
			const id = z.string().uuid().safeParse(fd.get('id'));
			if (!id.success) throw new LeaveError('Missing leave.');
			const note = String(fd.get('note') ?? '').trim().slice(0, 300);
			// Without full leave rights a manager may only withdraw a request still waiting.
			const full = event.locals.user!.isSystemAdmin || canAt(event.locals.access!, 'leave:*', establishmentId);
			const row = await cancelLeave(establishmentId, id.data, note, event.locals.user?.id ?? null, {
				onlySubmitted: !full
			});
			await writeAudit({
				establishmentId,
				actor: event.locals.user,
				action: 'leave.cancel',
				entityType: 'leave_request',
				entityId: row.id,
				after: { note }
			});
			return { ok: 'Leave cancelled. The schedule and DTR go back to normal.' };
		} catch (e) {
			return failure(e);
		}
	},

	/** A manager's suggestion for a holiday or memo; it changes nothing until Main HR approves it. */
	proposeMemo: async (event) => {
		requireCap(event.locals.user, event.locals.access, 'memo:propose', event.locals.establishment!.id);
		try {
			const establishmentId = event.locals.establishment!.id;
			const fd = await event.request.formData();
			const parsed = calendarFormSchema.safeParse({
				date: fd.get('date'),
				name: fd.get('name'),
				kind: fd.get('kind'),
				creditHours: fd.get('creditHours') ?? '',
				waiveLateness: fd.get('waiveLateness') === 'on'
			});
			if (!parsed.success) throw new CalendarError(parsed.error.issues[0]!.message);
			const row = await proposeCalendarDay(establishmentId, parsed.data, event.locals.user?.id ?? null);
			await writeAudit({
				establishmentId,
				actor: event.locals.user,
				action: 'calendar.propose',
				entityType: 'calendar_day',
				entityId: row.id,
				after: { date: row.date, name: row.name, kind: row.kind }
			});
			return { ok: `"${row.name}" sent to Main HR for approval.` };
		} catch (e) {
			return failure(e);
		}
	}
};
