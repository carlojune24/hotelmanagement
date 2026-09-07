import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { db } from '$lib/server/db/index';
import { hotels } from '$lib/server/db/schema/index';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'hotel:admin');
	const hotel = locals.hotel!;
	return {
		checkInTime: hotel.checkInTime,
		checkOutTime: hotel.checkOutTime,
		lateCheckoutFeePerHourCentavos: hotel.lateCheckoutFeePerHourCentavos,
		earlyCheckInFeePerHourCentavos: hotel.earlyCheckInFeePerHourCentavos
	};
};

const formSchema = z.object({
	checkInTime: z.string().regex(/^\d{2}:\d{2}$/),
	checkOutTime: z.string().regex(/^\d{2}:\d{2}$/),
	lateCheckoutFeePerHour: z.coerce.number().min(0).max(1_000_000),
	earlyCheckInFeePerHour: z.coerce.number().min(0).max(1_000_000)
});

export const actions: Actions = {
	update: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotel = event.locals.hotel!;
		const parsed = formSchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Check the fields and try again.' });
		const d = parsed.data;

		await db
			.update(hotels)
			.set({
				checkInTime: d.checkInTime,
				checkOutTime: d.checkOutTime,
				lateCheckoutFeePerHourCentavos: Math.round(d.lateCheckoutFeePerHour * 100),
				earlyCheckInFeePerHourCentavos: Math.round(d.earlyCheckInFeePerHour * 100),
				updatedAt: new Date()
			})
			.where(eq(hotels.id, hotel.id));

		await writeAudit({
			hotelId: hotel.id,
			actor: event.locals.user,
			action: 'hotel.update_check_in_out_policy',
			entityType: 'hotel',
			entityId: hotel.id,
			after: d
		});
		return { ok: 'Check-in/check-out policy saved.' };
	}
};
