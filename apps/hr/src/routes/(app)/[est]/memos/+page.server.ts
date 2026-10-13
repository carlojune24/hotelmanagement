import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { canAt } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { businessDateFor } from '$lib/server/time';
import {
	CalendarError,
	calendarFormSchema,
	listMemoProposals,
	proposeCalendarDay
} from '$lib/server/hr/calendar';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const est = locals.establishment!;
	requireCap(locals.user, locals.access, 'memo:propose', est.id);
	const canApprove = locals.user!.isSystemAdmin || canAt(locals.access!, 'approval:*', est.id);
	const rows = await listMemoProposals(est.id);
	return {
		today: businessDateFor(est.timezone),
		// Main HR enters holidays and memos directly (Leave rules & holidays); everyone else sends them.
		canPropose: !canApprove,
		proposals: rows.map((r) => ({
			id: r.id,
			date: r.date,
			name: r.name,
			kind: r.kind,
			creditMinutes: r.creditMinutes,
			waiveLateness: r.waiveLateness,
			status: r.status as 'submitted' | 'approved' | 'rejected',
			note: r.proposalNote,
			decisionNote: r.decisionNote,
			sentOn: r.submittedAt ? r.submittedAt.toISOString().slice(0, 10) : null,
			decidedOn: r.decidedAt ? r.decidedAt.toISOString().slice(0, 10) : null
		}))
	};
};

export const actions: Actions = {
	/** Sent to Main HR; it changes nothing on rosters or DTRs until it is approved there. */
	proposeMemo: async (event) => {
		const est = event.locals.establishment!;
		requireCap(event.locals.user, event.locals.access, 'memo:propose', est.id);
		try {
			const fd = await event.request.formData();
			const parsed = calendarFormSchema.safeParse({
				date: fd.get('date'),
				name: fd.get('name'),
				kind: fd.get('kind'),
				creditHours: fd.get('creditHours') ?? '',
				waiveLateness: fd.get('waiveLateness') === 'on'
			});
			if (!parsed.success) throw new CalendarError(parsed.error.issues[0]!.message);
			const note = z.string().trim().max(1000).safeParse(fd.get('note') ?? '');
			if (!note.success) throw new CalendarError('Keep the details under 1,000 characters.');
			const row = await proposeCalendarDay(est.id, parsed.data, event.locals.user?.id ?? null, note.data);
			await writeAudit({
				establishmentId: est.id,
				actor: event.locals.user,
				action: 'calendar.propose',
				entityType: 'calendar_day',
				entityId: row.id,
				after: { date: row.date, name: row.name, kind: row.kind }
			});
			return { ok: `"${row.name}" was sent to Main HR for approval.` };
		} catch (e) {
			if (e instanceof CalendarError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
