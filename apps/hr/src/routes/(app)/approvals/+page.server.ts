import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { listPendingApprovals } from '$lib/server/hr/approvals';
import { LeaveError, decideLeave } from '$lib/server/hr/leave';
import { OvertimeError, decideOvertime } from '$lib/server/hr/overtime';
import { PeriodError, decideWeek } from '$lib/server/hr/schedule-periods';
import { DtrSubmissionError, dtrBoard, receiveDtr, returnDtr } from '$lib/server/hr/dtr-submissions';
import { businessDateFor } from '$lib/server/time';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	// Org-wide on purpose: deciding is Main HR's call, never a single establishment's.
	requireCap(locals.user, locals.access, 'approval:*');
	const m = url.searchParams.get('month');
	const month = m && /^\d{4}-\d{2}$/.test(m) ? m : businessDateFor('Asia/Manila').slice(0, 7);
	const [pending, board] = await Promise.all([listPendingApprovals(), dtrBoard(month)]);
	return { pending, board, month };
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
		e instanceof PeriodError ||
		e instanceof DtrSubmissionError
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
	},

	decideDtr: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'approval:*');
		const parsed = decisionForm.safeParse(await fd(request));
		if (!parsed.success) return fail(400, { message: 'Choose receive or return.' });
		try {
			const row =
				parsed.data.decision === 'approved'
					? await receiveDtr(parsed.data.id, locals.user!.id)
					: await returnDtr(parsed.data.id, parsed.data.note, locals.user!.id);
			await writeAudit({
				actor: locals.user,
				establishmentId: row.establishmentId,
				action: parsed.data.decision === 'approved' ? 'dtr.received' : 'dtr.returned',
				entityType: 'dtr_submission',
				entityId: row.id,
				after: { cutoffStart: row.cutoffStart, note: parsed.data.note }
			});
		} catch (e) {
			return failure(e);
		}
		return { ok: parsed.data.decision === 'approved' ? 'DTR received.' : 'DTR sent back.' };
	}
};
