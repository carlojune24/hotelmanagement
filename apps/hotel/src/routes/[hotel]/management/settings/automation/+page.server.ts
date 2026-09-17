import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { JOB_KEYS, listJobTogglesForHotel, setJobToggle } from '$lib/server/jobs/toggles';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'hotel:admin');
	const jobs = await listJobTogglesForHotel(locals.hotel!.id);
	return { jobs };
};

const toggleSchema = z.object({
	jobKey: z.enum(JOB_KEYS as [string, ...string[]]),
	enabled: z.enum(['true', 'false'])
});

export const actions: Actions = {
	toggle: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const parsed = toggleSchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Bad request.' });

		await setJobToggle(
			event.locals.hotel!.id,
			parsed.data.jobKey as (typeof JOB_KEYS)[number],
			parsed.data.enabled === 'true',
			event.locals.user
		);
		return { ok: 'Saved.' };
	}
};
