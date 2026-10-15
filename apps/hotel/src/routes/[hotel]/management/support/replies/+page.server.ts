import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import {
	SupportError,
	deleteSupportCannedReply,
	listSupportCannedReplies,
	saveSupportCannedReply
} from '$lib/server/support-chat';
import type { Actions, PageServerLoad } from './$types';

/** The hotel's canned replies for the staff inbox "/" picker. Managers only. */
export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'support:manage');
	return { replies: await listSupportCannedReplies(locals.hotel!.id, { includeInactive: true }) };
};

const saveSchema = z.object({
	id: z.string().uuid().optional().or(z.literal('')),
	title: z.string().trim().min(1, 'Add a short title.').max(60),
	body: z.string().trim().min(1, 'Add the reply text.').max(1000),
	sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
	isActive: z.string().optional()
});

export const actions: Actions = {
	save: async ({ locals, request }) => {
		requireCap(locals.user, locals.role, 'support:manage');
		const parsed = saveSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the form.' });
		try {
			await saveSupportCannedReply({
				hotelId: locals.hotel!.id,
				actor: locals.user!,
				id: parsed.data.id || null,
				title: parsed.data.title,
				body: parsed.data.body,
				sortOrder: parsed.data.sortOrder,
				isActive: parsed.data.isActive === 'on'
			});
			return { saved: true };
		} catch (e) {
			if (e instanceof SupportError) return fail(400, { error: e.message });
			throw e;
		}
	},

	remove: async ({ locals, request }) => {
		requireCap(locals.user, locals.role, 'support:manage');
		const parsed = z.string().uuid().safeParse((await request.formData()).get('id'));
		if (!parsed.success) return fail(400, { error: 'That reply could not be found.' });
		await deleteSupportCannedReply({ hotelId: locals.hotel!.id, actor: locals.user!, id: parsed.data });
		return { removed: true };
	}
};
