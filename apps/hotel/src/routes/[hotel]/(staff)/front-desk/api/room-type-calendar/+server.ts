import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { getRoomTypeAvailabilityCalendar } from '$lib/server/availability';
import type { RequestHandler } from './$types';

const querySchema = z.object({
	roomTypeId: z.string().uuid(),
	from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

/** Live data for front desk's "suggest an open date" tape chart — see `getRoomTypeAvailabilityCalendar`. */
export const GET: RequestHandler = async ({ url, locals }) => {
	requireCap(locals.user, locals.role, 'booking:read');
	const hotelId = locals.hotel!.id;
	const parsed = querySchema.safeParse({
		roomTypeId: url.searchParams.get('roomTypeId'),
		from: url.searchParams.get('from'),
		to: url.searchParams.get('to')
	});
	if (!parsed.success) error(400, 'Invalid calendar request.');
	const { roomTypeId, from, to } = parsed.data;
	if (from >= to) error(400, 'to must be after from.');

	const calendar = await getRoomTypeAvailabilityCalendar(hotelId, roomTypeId, from, to);
	return json(calendar);
};
