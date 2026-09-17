import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { ModifyStayError, quoteModifyStay } from '$lib/server/booking-modify';
import type { RequestHandler } from './$types';

const quoteSchema = z.object({
	checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	roomTypeId: z.string().uuid().optional(),
	ratePlanId: z.string().uuid().optional(),
	occupancy: z.coerce.number().int().min(1).max(50).optional(),
	extraBeds: z.coerce.number().int().min(0).max(50).optional()
});

/** Live preview for the reservation detail page's "Modify booking" dialog — never
 *  mutates anything; the `?/modifyStay` form action re-derives and re-validates for real. */
export const POST: RequestHandler = async ({ request, locals, params }) => {
	requireCap(locals.user, locals.role, 'booking:write');
	if (params.kind !== 'room') error(400, 'Only room bookings can be modified this way.');
	const hotelId = locals.hotel!.id;
	const parsed = quoteSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, 'Invalid quote request.');

	try {
		const quote = await quoteModifyStay(hotelId, params.id, {
			newCheckIn: parsed.data.checkIn,
			newCheckOut: parsed.data.checkOut,
			newRoomTypeId: parsed.data.roomTypeId,
			newRatePlanId: parsed.data.ratePlanId,
			newOccupancy: parsed.data.occupancy,
			newExtraBeds: parsed.data.extraBeds
		});
		return json(quote);
	} catch (e) {
		if (e instanceof ModifyStayError) error(400, e.message);
		throw e;
	}
};
