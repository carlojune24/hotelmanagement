import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { cityPermits } from '$lib/server/db/schema/city';
import { writeAudit } from '$lib/server/audit';
import { requirePlatformAdmin } from '$lib/server/auth/rbac';
import { hotelPermits } from '$lib/server/city/permits';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	requirePlatformAdmin(locals.user);
	const data = await hotelPermits(params.hotelId);
	if (!data) error(404, 'Hotel not found');
	return data;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const emptyToUndef = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const recordSchema = z
	.object({
		permitNumber: z.string().trim().min(2, 'Enter the permit number.').max(80),
		issuedOn: z.preprocess(emptyToUndef, z.string().regex(DATE, 'Use a valid issue date.').optional()),
		expiresOn: z.string().regex(DATE, 'Enter the expiry date.'),
		notes: z.preprocess(emptyToUndef, z.string().trim().max(1000).optional())
	})
	.refine((d) => !d.issuedOn || d.issuedOn <= d.expiresOn, {
		message: 'The issue date must be on or before the expiry date.',
		path: ['issuedOn']
	});

export const actions: Actions = {
	/** Records a permit — a first permit or a renewal. Renewals are new rows, so history is kept. */
	record: async (event) => {
		requirePlatformAdmin(event.locals.user);
		const hotelId = event.params.hotelId;
		const raw = Object.fromEntries(await event.request.formData()) as Record<string, string>;
		const parsed = recordSchema.safeParse(raw);
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the permit details.', values: raw });
		}
		const d = parsed.data;

		const hotel = await hotelPermits(hotelId);
		if (!hotel) error(404, 'Hotel not found');

		const [dup] = await db
			.select({ id: cityPermits.id })
			.from(cityPermits)
			.where(
				and(
					eq(cityPermits.hotelId, hotelId),
					eq(cityPermits.permitNumber, d.permitNumber),
					eq(cityPermits.expiresOn, d.expiresOn)
				)
			);
		if (dup) return fail(409, { error: 'This permit (same number and expiry) is already recorded.', values: raw });

		const [row] = await db
			.insert(cityPermits)
			.values({
				hotelId,
				permitNumber: d.permitNumber,
				issuedOn: d.issuedOn ?? null,
				expiresOn: d.expiresOn,
				notes: d.notes ?? null,
				recordedBy: event.locals.user!.id
			})
			.returning({ id: cityPermits.id });

		await writeAudit({
			actor: event.locals.user,
			action: 'city.permit.record',
			entityType: 'city_permit',
			entityId: row!.id,
			after: { hotelId, permitNumber: d.permitNumber, expiresOn: d.expiresOn }
		});
		return { ok: true };
	}
};
