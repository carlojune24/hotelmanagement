import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { ModifyStayError, quoteModifyStay } from '$lib/server/booking-modify';
import type { RequestHandler } from './$types';

const quoteSchema = z.object({
	checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

/** Live preview for the reservation detail page's "Modify stay" dialog — never mutates
 *  anything; the `?/modifyStay` form action re-derives and re-validates for real. */
export const POST: RequestHandler = async ({ request, locals, params }) => {
	requireCap(locals.user, locals.role, 'booking:write');
	if (params.kind !== 'room') error(400, 'Only room bookings can have their dates modified.');
	const hotelId = locals.hotel!.id;
	const parsed = quoteSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, 'Invalid quote request.');

	try {
		const quote = await quoteModifyStay(hotelId, params.id, parsed.data.checkIn, parsed.data.checkOut);
		return json(quote);
	} catch (e) {
		if (e instanceof ModifyStayError) error(400, e.message);
		throw e;
	}
};
