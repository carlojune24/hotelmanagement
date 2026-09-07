import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { priceEventHall } from '$lib/server/pricing';
import type { RequestHandler } from './$types';

const quoteSchema = z.object({
	functionHallId: z.string().uuid(),
	startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM'),
	endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')
});

/**
 * Live price quote for the storefront's Function Hall reservation mini-form —
 * called (debounced) as the guest adjusts date/time/duration. Hourly math
 * never happens client-side; this is the one source of truth for what a hall
 * reservation costs before it's added to the invoice.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const hotelId = locals.hotel!.id;
	const parsed = quoteSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, 'Invalid quote request.');

	try {
		const price = await priceEventHall({
			hotelId,
			functionHallId: parsed.data.functionHallId,
			startTime: parsed.data.startTime,
			endTime: parsed.data.endTime
		});
		return json(price);
	} catch (e) {
		error(400, e instanceof Error ? e.message : 'Could not price that hall booking.');
	}
};
