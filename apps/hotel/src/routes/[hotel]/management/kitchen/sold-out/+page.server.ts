import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { recordId } from '$lib/rate-validation';
import { setItemAvailability } from '$lib/server/dining-menu';
import { listDishesForKitchen } from '$lib/server/kitchen';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, depends }) => {
	depends('app:kitchen-soldout');
	requireCap(locals.user, locals.role, 'kitchen:read');
	return { dishes: await listDishesForKitchen(locals.hotel!.id) };
};

export const actions: Actions = {
	/** The "86" switch: a sold-out dish disappears from the guest QR and online menus at once. */
	setAvailable: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'kitchen:write');
		const parsed = z
			.object({ itemId: recordId(), isAvailable: z.enum(['true', 'false']) })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'That dish could not be found.' });
		const available = parsed.data.isAvailable === 'true';
		const name = await setItemAvailability({
			hotelId: event.locals.hotel!.id,
			itemId: parsed.data.itemId,
			isAvailable: available,
			actor: event.locals.user
		});
		if (name === null) return fail(404, { error: 'That dish could not be found.' });
		return { ok: available ? `"${name}" is back on.` : `"${name}" is sold out.` };
	}
};
