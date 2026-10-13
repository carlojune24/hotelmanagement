import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { establishments } from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import {
	mergeNightDiffIntoConfig,
	nightDiffSchema,
	parseNightDiff
} from '$lib/server/hr/night-diff';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.access, 'schedule:*', locals.establishment!.id);
	return { nightDiff: parseNightDiff(locals.establishment!.config) };
};

export const actions: Actions = {
	saveNightDiff: async (event) => {
		requireCap(event.locals.user, event.locals.access, 'schedule:*', event.locals.establishment!.id);
		const establishment = event.locals.establishment!;
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = nightDiffSchema.safeParse(raw);
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the night differential.' });
		}
		const before = parseNightDiff(establishment.config);
		await db
			.update(establishments)
			.set({ config: mergeNightDiffIntoConfig(establishment.config, parsed.data), updatedAt: new Date() })
			.where(eq(establishments.id, establishment.id));
		await writeAudit({
			establishmentId: establishment.id,
			actor: event.locals.user,
			action: 'hr.night_diff.update',
			entityType: 'establishment',
			entityId: establishment.id,
			before,
			after: parsed.data
		});
		return { ok: 'Night differential saved.' };
	}
};
