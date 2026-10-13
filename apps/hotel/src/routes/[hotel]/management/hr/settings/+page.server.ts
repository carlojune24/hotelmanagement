import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { hotels } from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import {
	mergeNightDiffIntoConfig,
	nightDiffSchema,
	parseNightDiff
} from '$lib/server/hr/night-diff';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'schedule:*');
	return { nightDiff: parseNightDiff(locals.hotel!.config) };
};

export const actions: Actions = {
	saveNightDiff: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'schedule:*');
		const hotel = event.locals.hotel!;
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = nightDiffSchema.safeParse(raw);
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the night differential.' });
		}
		const before = parseNightDiff(hotel.config);
		await db
			.update(hotels)
			.set({ config: mergeNightDiffIntoConfig(hotel.config, parsed.data), updatedAt: new Date() })
			.where(eq(hotels.id, hotel.id));
		await writeAudit({
			hotelId: hotel.id,
			actor: event.locals.user,
			action: 'hr.night_diff.update',
			entityType: 'hotel',
			entityId: hotel.id,
			before,
			after: parsed.data
		});
		return { ok: 'Night differential saved.' };
	}
};
