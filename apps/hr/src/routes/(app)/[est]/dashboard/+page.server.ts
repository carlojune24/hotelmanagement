import { error, fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { absenceNotes } from '$lib/server/db/schema/index';
import { canAt } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import { getOrganization } from '$lib/server/establishments';
import { announcementsFor } from '$lib/server/hr/announcements';
import { getDashboard } from '$lib/server/hr/dashboard';
import { businessDateFor } from '$lib/server/time';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const est = locals.establishment;
	if (!est) error(404, 'Not found');
	const today = businessDateFor(est.timezone);
	const org = await getOrganization();
	const [dashboard, notices] = await Promise.all([
		getDashboard(est.id, est.slug, today, est.timezone),
		announcementsFor(org.id, est.id, today)
	]);
	return {
		canMarkAbsence: !!locals.user?.isSystemAdmin || (!!locals.access && canAt(locals.access, 'dtr:write', est.id)),
		dashboard,
		announcements: notices.map((n) => ({
			id: n.id,
			title: n.title,
			body: n.body,
			pinned: n.pinned,
			postedOn: n.createdAt.toISOString().slice(0, 10),
			expiresOn: n.expiresOn
		}))
	};
};

/** Ticks or unticks "absent today". Information only: writes absence_notes and nothing else. */
export const actions: Actions = {
	mark: async ({ request, locals }) => {
		const est = locals.establishment;
		if (!est) error(404, 'Not found');
		requireCap(locals.user, locals.access, 'dtr:write', est.id);
		const f = await request.formData();
		const employeeId = String(f.get('employeeId') ?? '');
		const absent = f.get('absent') === '1';
		const note = String(f.get('note') ?? '').trim().slice(0, 200);
		const today = businessDateFor(est.timezone);
		// Only someone rostered here today can be marked, which also scopes the id to this establishment.
		const d = await getDashboard(est.id, est.slug, today, est.timezone);
		if (!d.rosteredToday.some((p) => p.id === employeeId)) return fail(400, { message: 'Not rostered here today.' });
		if (!absent) {
			await db.delete(absenceNotes).where(and(eq(absenceNotes.employeeId, employeeId), eq(absenceNotes.date, today)));
			return { ok: true };
		}
		await db
			.insert(absenceNotes)
			.values({
				establishmentId: est.id,
				employeeId,
				date: today,
				note,
				markedByUserId: locals.user!.id,
				markedByName: locals.user!.name
			})
			.onConflictDoUpdate({
				target: [absenceNotes.employeeId, absenceNotes.date],
				set: { note, markedByUserId: locals.user!.id, markedByName: locals.user!.name }
			});
		return { ok: true };
	}
};
