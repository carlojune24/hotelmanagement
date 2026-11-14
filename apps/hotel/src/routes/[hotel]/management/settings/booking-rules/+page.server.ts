import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { db } from '$lib/server/db/index';
import { hotels } from '$lib/server/db/schema/index';
import { mergeCapacityOverrideIntoConfig, parseCapacityOverride } from '$lib/server/capacity-override';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'hotel:admin');
	return { frontDeskCapacityOverride: parseCapacityOverride(locals.hotel!.config).frontDesk };
};

export const actions: Actions = {
	capacityOverride: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotel = event.locals.hotel!;
		const parsed = z
			.object({ enabled: z.enum(['true', 'false']) })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Bad request.' });

		const before = parseCapacityOverride(hotel.config);
		const after = { frontDesk: parsed.data.enabled === 'true' };
		await db
			.update(hotels)
			.set({ config: mergeCapacityOverrideIntoConfig(hotel.config, after), updatedAt: new Date() })
			.where(eq(hotels.id, hotel.id));

		await writeAudit({
			hotelId: hotel.id,
			actor: event.locals.user,
			action: 'hotel.update_capacity_override',
			entityType: 'hotel',
			entityId: hotel.id,
			before,
			after
		});
		return { ok: after.frontDesk ? 'Front desk can now override guest capacity.' : 'Front desk can no longer override guest capacity.' };
	}
};
