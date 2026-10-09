import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { businessDateFor } from '$lib/server/finance/shared';
import { listEmployees } from '$lib/server/hr/employees';
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
	requireCap(locals.user, locals.role, 'leave:*');
	const hotel = locals.hotel!;
	const yearParam = Number(url.searchParams.get('year'));
	const year =
		Number.isInteger(yearParam) && yearParam >= 2000 && yearParam <= 2100
			? yearParam
			: Number(businessDateFor(hotel.timezone).slice(0, 4));

	const [requests, types, employees] = await Promise.all([
		listLeaveRequests(hotel.id, year),
		listLeaveTypes(hotel.id),
		listEmployees(hotel.id)
	]);
	return {
		year,
		today: businessDateFor(hotel.timezone),
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
	if (e instanceof LeaveError) return fail(400, { error: e.message });
	throw e;
}

export const actions: Actions = {
	/** What the request would count and leave behind, shown live in the dialog. Writes nothing. */
	preview: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'leave:*');
		const parsed = parseForm(await event.request.formData());
		if (!parsed.success) return { preview: null, previewError: null };
		try {
			const p = await previewLeave(event.locals.hotel!.id, parsed.data);
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
		requireCap(event.locals.user, event.locals.role, 'leave:*');
		try {
			const hotelId = event.locals.hotel!.id;
			const parsed = parseForm(await event.request.formData());
			if (!parsed.success) throw new LeaveError(parsed.error.issues[0]!.message);
			const r = await fileLeave(hotelId, parsed.data, event.locals.user?.id ?? null);
			await writeAudit({
				hotelId,
				actor: event.locals.user,
				action: 'leave.file',
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
			return { ok: `${r.type.name} filed: ${r.request.days} day${r.request.days === 1 ? '' : 's'}. Save the month's DTR again to carry it over.` };
		} catch (e) {
			return failure(e);
		}
	},

	cancel: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'leave:*');
		try {
			const hotelId = event.locals.hotel!.id;
			const fd = await event.request.formData();
			const id = z.string().uuid().safeParse(fd.get('id'));
			if (!id.success) throw new LeaveError('Missing leave.');
			const note = String(fd.get('note') ?? '').trim().slice(0, 300);
			const row = await cancelLeave(hotelId, id.data, note, event.locals.user?.id ?? null);
			await writeAudit({
				hotelId,
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
	}
};
