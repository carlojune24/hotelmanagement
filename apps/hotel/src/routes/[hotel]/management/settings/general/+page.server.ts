import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { hotels } from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { getScPwdDiscountBps, setScPwdDiscountBps } from '$lib/server/sc-pwd-discount';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'hotel:admin');
	const hotelId = locals.hotel!.id;
	const [details, scPwdDiscountBps] = await Promise.all([
		db
			.select({
				currency: hotels.currency,
				vatRateBps: hotels.vatRateBps,
				timezone: hotels.timezone,
				legalName: hotels.legalName,
				addressLine: hotels.addressLine,
				city: hotels.city
			})
			.from(hotels)
			.where(eq(hotels.id, hotelId))
			.then((r) => r[0]!),
		getScPwdDiscountBps(hotelId)
	]);
	return { details, scPwdDiscountBps };
};

export const actions: Actions = {
	// Moved here from Finance -> Settings so the hotel's basics live in one place; same fields, same audit.
	updateHotelDetails: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;
		const p = z
			.object({
				currency: z.enum(['PHP']),
				vatRatePct: z.coerce.number().min(0).max(30),
				timezone: z.string().min(1).max(64),
				scPwdDiscountPct: z.coerce.number().min(0).max(100).default(20)
			})
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!p.success) return fail(400, { error: 'Check the hotel details.' });

		await db
			.update(hotels)
			.set({
				currency: p.data.currency,
				vatRateBps: Math.round(p.data.vatRatePct * 100),
				timezone: p.data.timezone,
				updatedAt: new Date()
			})
			.where(eq(hotels.id, hotelId));
		await setScPwdDiscountBps(hotelId, Math.round(p.data.scPwdDiscountPct * 100), event.locals.user);
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'hotel.update_details',
			entityType: 'hotel',
			entityId: hotelId,
			after: p.data
		});
		return { ok: 'Hotel details saved.' };
	}
};
