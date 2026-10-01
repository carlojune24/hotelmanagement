import { fail, redirect } from '@sveltejs/kit';
import { ulid } from 'ulid';
import { db } from '$lib/server/db/index';
import { cityApplications } from '$lib/server/db/schema/city';
import { writeAudit } from '$lib/server/audit';
import { requirePlatformAdmin } from '$lib/server/auth/rbac';
import { applicationSchema } from '$lib/city/applications';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async (event) => {
		requirePlatformAdmin(event.locals.user);
		const raw = Object.fromEntries(await event.request.formData()) as Record<string, string>;
		const parsed = applicationSchema.safeParse(raw);
		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? 'Check the highlighted details.',
				values: raw
			});
		}
		const d = parsed.data;

		const [row] = await db
			.insert(cityApplications)
			.values({
				ref: `APP-${ulid().slice(-8)}`,
				hotelName: d.hotelName,
				addressLine: d.addressLine ?? null,
				city: d.city ?? null,
				contactName: d.contactName,
				contactEmail: d.contactEmail,
				contactPhone: d.contactPhone ?? null,
				permitNumber: d.permitNumber ?? null,
				permitExpiresOn: d.permitExpiresOn ?? null,
				declaredRooms: d.declaredRooms ?? null,
				notes: d.notes ?? null,
				enteredBy: event.locals.user!.id
			})
			.returning({ id: cityApplications.id, ref: cityApplications.ref });

		await writeAudit({
			actor: event.locals.user,
			action: 'city.application.create',
			entityType: 'city_application',
			entityId: row!.id,
			after: { ref: row!.ref, hotelName: d.hotelName }
		});
		redirect(303, `/city/applications/${row!.id}`);
	}
};
