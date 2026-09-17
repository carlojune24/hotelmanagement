import { fail } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { functionHalls } from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'hotel:admin');
	const hotelId = locals.hotel!.id;

	const halls = await db
		.select()
		.from(functionHalls)
		.where(eq(functionHalls.hotelId, hotelId))
		.orderBy(asc(functionHalls.sortOrder), asc(functionHalls.name));

	return { halls };
};

const toCentavos = (php: number) => Math.round(php * 100);

const createSchema = z.object({
	name: z.string().min(2).max(120),
	capacity: z.coerce.number().int().min(1).max(2000),
	baseHours: z.coerce.number().int().min(1).max(24),
	basePricePhp: z.coerce.number().min(0),
	extraHourFeePhp: z.coerce.number().min(0)
});

export const actions: Actions = {
	create: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;

		const parsed = createSchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Check the function hall details and try again.' });

		const [row] = await db
			.insert(functionHalls)
			.values({
				hotelId,
				name: parsed.data.name.trim(),
				capacity: parsed.data.capacity,
				baseHours: parsed.data.baseHours,
				basePriceCentavos: toCentavos(parsed.data.basePricePhp),
				extraHourFeeCentavos: toCentavos(parsed.data.extraHourFeePhp)
			})
			.returning({ id: functionHalls.id });

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'function_hall.create',
			entityType: 'function_hall',
			entityId: row!.id,
			after: parsed.data
		});

		return { ok: `Created "${parsed.data.name}".`, createdHallId: row!.id };
	}
};
