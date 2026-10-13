import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { getOrganization, listEstablishments } from '$lib/server/establishments';
import {
	AnnouncementError,
	announcementSchema,
	createAnnouncement,
	listAnnouncements,
	setAnnouncementStatus,
	updateAnnouncement
} from '$lib/server/hr/announcements';
import { businessDateFor } from '$lib/server/time';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.access, 'announcement:*');
	const org = await getOrganization();
	const [rows, ests] = await Promise.all([listAnnouncements(org.id), listEstablishments()]);
	const today = businessDateFor('Asia/Manila');
	return {
		today,
		establishments: ests.filter((e) => e.status === 'active').map((e) => ({ id: e.id, name: e.name })),
		announcements: rows.map((a) => {
			const audience = Array.isArray(a.audience) ? (a.audience as string[]) : null;
			const expired = a.expiresOn !== null && a.expiresOn < today;
			return {
				id: a.id,
				title: a.title,
				body: a.body,
				pinned: a.pinned,
				expiresOn: a.expiresOn,
				audience,
				status: a.status as 'active' | 'archived',
				showing: a.status === 'active' && !expired,
				expired,
				postedOn: a.createdAt.toISOString().slice(0, 10)
			};
		})
	};
};

async function form(request: Request) {
	const fd = await request.formData();
	return {
		title: fd.get('title'),
		body: fd.get('body'),
		establishmentIds: fd.get('everyone') === 'on' ? [] : fd.getAll('establishmentIds').map(String),
		pinned: fd.get('pinned') === 'on',
		expiresOn: fd.get('expiresOn'),
		id: fd.get('id'),
		everyone: fd.get('everyone') === 'on'
	};
}

const noAudience = (v: { everyone: boolean; establishmentIds: string[] }) =>
	!v.everyone && v.establishmentIds.length === 0;

export const actions: Actions = {
	create: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'announcement:*');
		const { id: _id, everyone, ...values } = await form(request);
		const parsed = announcementSchema.safeParse(values);
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the announcement.' });
		// "Every establishment" unticked and nothing chosen — ask rather than silently posting to all.
		if (noAudience({ everyone, establishmentIds: values.establishmentIds })) {
			return fail(400, { error: 'Choose who this is for, or tick Every establishment.' });
		}
		const org = await getOrganization();
		const row = await createAnnouncement(org.id, parsed.data, locals.user!.id);
		await writeAudit({
			actor: locals.user,
			action: 'announcement.create',
			entityType: 'announcement',
			entityId: row.id,
			after: { title: row.title, audience: row.audience, pinned: row.pinned, expiresOn: row.expiresOn }
		});
		return { ok: 'Posted. It now shows on the dashboards it is addressed to.' };
	},

	update: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'announcement:*');
		const { id, everyone, ...values } = await form(request);
		const idOk = z.string().uuid().safeParse(id);
		const parsed = announcementSchema.safeParse(values);
		if (!idOk.success || !parsed.success) {
			return fail(400, { error: (!parsed.success && parsed.error.issues[0]?.message) || 'Check the announcement.' });
		}
		if (noAudience({ everyone, establishmentIds: values.establishmentIds })) {
			return fail(400, { error: 'Choose who this is for, or tick Every establishment.' });
		}
		try {
			const org = await getOrganization();
			const row = await updateAnnouncement(org.id, idOk.data, parsed.data);
			await writeAudit({
				actor: locals.user,
				action: 'announcement.update',
				entityType: 'announcement',
				entityId: row.id,
				after: { title: row.title, audience: row.audience, pinned: row.pinned, expiresOn: row.expiresOn }
			});
		} catch (e) {
			if (e instanceof AnnouncementError) return fail(400, { error: e.message });
			throw e;
		}
		return { ok: 'Saved.' };
	},

	status: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'announcement:*');
		const parsed = z
			.object({ id: z.string().uuid(), to: z.enum(['active', 'archived']) })
			.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: 'Unknown announcement.' });
		try {
			const org = await getOrganization();
			const row = await setAnnouncementStatus(org.id, parsed.data.id, parsed.data.to);
			await writeAudit({
				actor: locals.user,
				action: `announcement.${parsed.data.to}`,
				entityType: 'announcement',
				entityId: row.id
			});
		} catch (e) {
			if (e instanceof AnnouncementError) return fail(400, { error: e.message });
			throw e;
		}
		return { ok: parsed.data.to === 'archived' ? 'Taken down.' : 'Showing again.' };
	}
};
