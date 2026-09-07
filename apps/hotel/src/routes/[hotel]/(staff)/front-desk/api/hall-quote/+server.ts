import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { checkHallAvailability } from '$lib/server/hall-availability';
import { priceEventHall } from '$lib/server/pricing';
import type { RequestHandler } from './$types';

const quoteSchema = z.object({
	functionHallId: z.string().uuid(),
	eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM'),
	endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')
});

/**
 * Live price quote for the front desk's hall walk-in drawer — unlike the
 * guest-facing `/book/api/hall-quote` (which only prices; a conflicting slot
 * is only caught at order-creation time, after the guest has already committed
 * through the whole checkout flow), this also checks the slot is actually free
 * *before* pricing it, since front desk is deciding whether to accept a walk-in
 * right there at the counter and needs to know about a conflict immediately,
 * not after filling in the guest's details and submitting.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	requireCap(locals.user, locals.role, 'booking:write');
	const hotelId = locals.hotel!.id;
	const parsed = quoteSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, 'Invalid quote request.');
	const { functionHallId, eventDate, startTime, endTime } = parsed.data;
	if (startTime >= endTime) error(400, 'End time must be after start time.');

	const available = await checkHallAvailability({ hotelId, functionHallId, eventDate, startTime, endTime });
	if (!available) return json({ available: false });

	try {
		const price = await priceEventHall({ hotelId, functionHallId, startTime, endTime });
		return json({ available: true, price });
	} catch (e) {
		error(400, e instanceof Error ? e.message : 'Could not price that hall booking.');
	}
};
