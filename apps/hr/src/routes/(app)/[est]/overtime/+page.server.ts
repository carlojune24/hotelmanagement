import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { canAt } from '$lib/authz';
import { monthBounds } from '$lib/roster';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { businessDateFor } from '$lib/server/time';
import { listEmployees } from '$lib/server/hr/employees';
import {
	OvertimeError,
	cancelOvertime,
	fileOvertime,
	listOvertime,
	overtimeFormSchema
} from '$lib/server/hr/overtime';
import type { Actions, PageServerLoad } from './$types';

const isApprover = (locals: App.Locals) =>
	locals.user!.isSystemAdmin || canAt(locals.access!, 'approval:*', locals.establishment!.id);

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.access, 'overtime:file', locals.establishment!.id);
	const est = locals.establishment!;
	const today = businessDateFor(est.timezone);
	const monthParam = url.searchParams.get('month');
	const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : today.slice(0, 7);
	const { start, end } = monthBounds(`${month}-01`);

	const [requests, employees] = await Promise.all([
		listOvertime(est.id, start, end),
		listEmployees(est.id)
	]);
	return {
		month,
		today,
		requests,
		canApprove: isApprover(locals),
		employees: employees
			.filter((e) => e.status !== 'separated')
			.map((e) => ({ id: e.id, name: `${e.lastName}, ${e.firstName}` }))
	};
};

function failure(e: unknown) {
	if (e instanceof OvertimeError) return fail(400, { error: e.message });
	throw e;
}

export const actions: Actions = {
	file: async (event) => {
		requireCap(event.locals.user, event.locals.access, 'overtime:file', event.locals.establishment!.id);
		try {
			const establishmentId = event.locals.establishment!.id;
			const fd = await event.request.formData();
			const parsed = overtimeFormSchema.safeParse({
				employeeId: fd.get('employeeId'),
				date: fd.get('date'),
				startTime: fd.get('startTime'),
				endTime: fd.get('endTime'),
				reason: fd.get('reason') ?? ''
			});
			if (!parsed.success) throw new OvertimeError(parsed.error.issues[0]!.message);
			const approver = isApprover(event.locals);
			const row = await fileOvertime(establishmentId, parsed.data, event.locals.user?.id ?? null, approver);
			await writeAudit({
				establishmentId,
				actor: event.locals.user,
				action: approver ? 'overtime.file' : 'overtime.submit',
				entityType: 'overtime_request',
				entityId: row.id,
				after: { employeeId: row.employeeId, date: row.date, minutes: row.minutes }
			});
			return {
				ok: approver
					? 'Overtime filed. Save the month’s DTR again to carry it over.'
					: 'Overtime sent to Main HR for approval.'
			};
		} catch (e) {
			return failure(e);
		}
	},

	cancel: async (event) => {
		requireCap(event.locals.user, event.locals.access, 'overtime:file', event.locals.establishment!.id);
		try {
			const establishmentId = event.locals.establishment!.id;
			const fd = await event.request.formData();
			const id = z.string().uuid().safeParse(fd.get('id'));
			if (!id.success) throw new OvertimeError('Missing overtime.');
			const note = String(fd.get('note') ?? '').trim().slice(0, 300);
			// Without approval rights a manager may only withdraw a request still waiting.
			const row = await cancelOvertime(establishmentId, id.data, note, event.locals.user?.id ?? null, {
				onlySubmitted: !isApprover(event.locals)
			});
			await writeAudit({
				establishmentId,
				actor: event.locals.user,
				action: 'overtime.cancel',
				entityType: 'overtime_request',
				entityId: row.id,
				after: { note }
			});
			return { ok: 'Overtime cancelled.' };
		} catch (e) {
			return failure(e);
		}
	}
};
