import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { SupportError, deleteSupportFaq, listSupportFaqs, saveSupportFaq } from '$lib/server/support-chat';
import type { Actions, PageServerLoad } from './$types';

/** The FAQ chips guests see first in the support widget. Two built-in answers (check-in/out times,
 *  how to book) always come ahead of these. */
export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'support:manage');
	return { faqs: await listSupportFaqs(locals.hotel!.id, { includeInactive: true }) };
};

const saveSchema = z.object({
	id: z.string().uuid().optional().or(z.literal('')),
	question: z.string().trim().min(1, 'Add a question.').max(200),
	answer: z.string().trim().min(1, 'Add an answer.').max(2000),
	sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
	isActive: z.string().optional()
});

export const actions: Actions = {
	save: async ({ locals, request }) => {
		requireCap(locals.user, locals.role, 'support:manage');
		const parsed = saveSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the form.' });
		try {
			await saveSupportFaq({
				hotelId: locals.hotel!.id,
				actor: locals.user!,
				id: parsed.data.id || null,
				question: parsed.data.question,
				answer: parsed.data.answer,
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
		if (!parsed.success) return fail(400, { error: 'That FAQ could not be found.' });
		await deleteSupportFaq({ hotelId: locals.hotel!.id, actor: locals.user!, id: parsed.data });
		return { removed: true };
	}
};
