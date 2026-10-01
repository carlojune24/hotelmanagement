import { asc, eq } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { hotels } from '$lib/server/db/schema/index';
import { createApiKey, listAllApiKeys, revokeApiKey } from '$lib/server/auth/api-key';
import { writeAudit } from '$lib/server/audit';
import { requirePlatformAdmin } from '$lib/server/auth/rbac';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [hotelRows, keys] = await Promise.all([
		db
			.select({ id: hotels.id, name: hotels.name, slug: hotels.slug })
			.from(hotels)
			.orderBy(asc(hotels.name)),
		listAllApiKeys()
	]);
	return { hotels: hotelRows, keys };
};

const createSchema = z.object({
	name: z.string().min(1).max(120),
	hotelIds: z.array(z.string().uuid()).min(1, 'Pick at least one hotel.')
});

export const actions: Actions = {
	createApiKey: async (event) => {
		requirePlatformAdmin(event.locals.user);
		const fd = await event.request.formData();
		const parsed = createSchema.safeParse({
			name: fd.get('name'),
			hotelIds: fd.getAll('hotelIds')
		});
		if (!parsed.success) return fail(400, { error: 'Give the key a name and pick at least one hotel.' });

		const { id, rawKey } = await createApiKey({
			name: parsed.data.name,
			hotelIds: parsed.data.hotelIds,
			createdByUserId: event.locals.user?.id ?? null
		});
		await writeAudit({
			hotelId: null,
			actor: event.locals.user,
			action: 'admin.create_api_key',
			entityType: 'api_key',
			entityId: id,
			after: { name: parsed.data.name, hotelIds: parsed.data.hotelIds }
		});
		// Shown once — never retrievable again after this response.
		return { ok: 'API key created — copy it now, it will not be shown again.', rawKey };
	},

	revokeApiKeyAction: async (event) => {
		requirePlatformAdmin(event.locals.user);
		const id = (await event.request.formData()).get('id');
		if (typeof id !== 'string') return fail(400, { error: 'Missing key.' });
		await revokeApiKey(id);
		await writeAudit({
			hotelId: null,
			actor: event.locals.user,
			action: 'admin.revoke_api_key',
			entityType: 'api_key',
			entityId: id
		});
		return { ok: 'API key revoked.' };
	}
};
