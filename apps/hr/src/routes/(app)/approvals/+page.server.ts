import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { listPendingApprovals } from '$lib/server/hr/approvals';
import { CalendarError, decideCalendarDay } from '$lib/server/hr/calendar';
import { LeaveError, decideLeave } from '$lib/server/hr/leave';
import { OvertimeError, decideOvertime } from '$lib/server/hr/overtime';
import { PeriodError, decideWeek } from '$lib/server/hr/schedule-periods';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	// Org-wide on purpose: deciding is Main HR's call, never a single establishment's.
	requireCap(locals.user, locals.access, 'approval:*');
	return { pending: await listPendingApprovals() };
};

const decisionForm = z.object({
	id: z.string().uuid(),
	decision: z.enum(['approved', 'rejected']),
	note: z.string().trim().max(300).default('')
});

const weekForm = z.object({
	establishmentId: z.string().uuid(),
	weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	decision: z.enum(['approved', 'rejected']),
	note: z.string().trim().max(300).default('')
});

const fd = async (request: Request) => Object.fromEntries(await request.formData());

function failure(e: unknown) {
	if (
		e instanceof LeaveError ||
		e instanceof OvertimeError ||
		e instanceof CalendarError ||
		e instanceof PeriodError
	) {
		return fail(400, { message: e.message });
	}
	throw e;
}

export const actions: Actions = {
	decideLeave: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'approval:*');
		const parsed = decisionForm.safeParse(await fd(request));
		if (!parsed.success) return fail(400, { message: 'Choose approve or reject.' });
		try {
			const row = await decideLeave(parsed.data.id, parsed.data.decision, parsed.data.note, locals.user!.id);
			await writeAudit({
				actor: locals.user,
				establishmentId: row.establishmentId,
				action: `leave.${parsed.data.decision}`,
				entityType: 'leave_request',
				entityId: row.id,
				after: { note: parsed.data.note }
			});
		} catch (e) {
			return failure(e);
		}
		return { ok: parsed.data.decision === 'approved' ? 'Leave approved.' : 'Leave rejected.' };
	},

	decideOvertime: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'approval:*');
		const parsed = decisionForm.safeParse(await fd(request));
		if (!parsed.success) return fail(400, { message: 'Choose approve or reject.' });
		try {
			const row = await decideOvertime(parsed.data.id, parsed.data.decision, parsed.data.note, locals.user!.id);
			await writeAudit({
				actor: locals.user,
				establishmentId: row.establishmentId,
				action: `overtime.${parsed.data.decision}`,
				entityType: 'overtime_request',
				entityId: row.id,
				after: { note: parsed.data.note }
			});
		} catch (e) {
			return failure(e);
		}
		return { ok: parsed.data.decision === 'approved' ? 'Overtime approved.' : 'Overtime rejected.' };
	},

	decideMemo: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'approval:*');
		const parsed = decisionForm.safeParse(await fd(request));
		if (!parsed.success) return fail(400, { message: 'Choose approve or reject.' });
		try {
			const row = await decideCalendarDay(parsed.data.id, parsed.data.decision, parsed.data.note, locals.user!.id);
			await writeAudit({
				actor: locals.user,
				establishmentId: row.establishmentId,
				action: `calendar.${parsed.data.decision}`,
				entityType: 'calendar_day',
				entityId: row.id,
				after: { note: parsed.data.note }
			});
		} catch (e) {
			return failure(e);
		}
		return { ok: parsed.data.decision === 'approved' ? 'Memo approved.' : 'Memo rejected.' };
	},

	decideWeek: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'approval:*');
		const parsed = weekForm.safeParse(await fd(request));
		if (!parsed.success) return fail(400, { message: 'Choose approve or return.' });
		try {
			await decideWeek(
				parsed.data.establishmentId,
				parsed.data.weekStart,
				parsed.data.decision === 'approved' ? 'approved' : 'returned',
				parsed.data.note,
				locals.user!.id
			);
			await writeAudit({
				actor: locals.user,
				establishmentId: parsed.data.establishmentId,
				action: `roster.${parsed.data.decision === 'approved' ? 'approved' : 'returned'}`,
				entityType: 'schedule_period',
				entityId: parsed.data.weekStart,
				after: { note: parsed.data.note }
			});
		} catch (e) {
			return failure(e);
		}
		return { ok: parsed.data.decision === 'approved' ? 'Roster approved.' : 'Roster sent back.' };
	}
};
