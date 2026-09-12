import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { getHallAvailabilityCalendar } from '$lib/server/hall-availability';
import type { RequestHandler } from './$types';

const querySchema = z.object({
	hallId: z.string().uuid(),
	from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

/** Live data for front desk's "suggest an open date" tape chart — see `getHallAvailabilityCalendar`. */
export const GET: RequestHandler = async ({ url, locals }) => {
	requireCap(locals.user, locals.role, 'booking:read');
	const hotelId = locals.hotel!.id;
	const parsed = querySchema.safeParse({
		hallId: url.searchParams.get('hallId'),
		from: url.searchParams.get('from'),
		to: url.searchParams.get('to')
	});
	if (!parsed.success) error(400, 'Invalid calendar request.');
	const { hallId, from, to } = parsed.data;
	if (from > to) error(400, 'to must not be before from.');

	const calendar = await getHallAvailabilityCalendar(hotelId, hallId, from, to);
	return json(calendar);
};
