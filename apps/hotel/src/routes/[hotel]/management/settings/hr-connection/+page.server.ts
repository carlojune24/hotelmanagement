import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import {
	HrLinkError,
	getConnection,
	removeConnection,
	saveConnection
} from '$lib/server/hr-link/client';
import { syncHrLinkedMembers } from '$lib/server/hr-link/sync';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'team:*');
	const conn = await getConnection(locals.hotel!.id);
	return {
		connection: conn
			? {
					baseUrl: conn.baseUrl,
					keyHint: conn.apiKeyHint,
					establishmentName: conn.establishmentName,
					lastSyncAt: conn.lastSyncAt,
					lastError: conn.lastError
				}
			: null
	};
};

const connectSchema = z.object({
	baseUrl: z.string().trim().min(1, 'Enter the HR app address.'),
	apiKey: z.string().trim().min(1, 'Paste the key from Main HR.')
});

export const actions: Actions = {
	connect: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'team:*');
		const hotelId = event.locals.hotel!.id;
		const parsed = connectSchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]!.message });
		try {
			const r = await saveConnection(hotelId, parsed.data.baseUrl, parsed.data.apiKey, event.locals.user?.id ?? null);
			await writeAudit({
				hotelId,
				actor: event.locals.user,
				action: 'hr.connect',
				entityType: 'hr_connection',
				entityId: hotelId,
				after: { baseUrl: parsed.data.baseUrl, establishment: r.establishmentName }
			});
			return { ok: `Connected to HR as “${r.establishmentName}”.` };
		} catch (e) {
			if (e instanceof HrLinkError) return fail(400, { error: e.message });
			throw e;
		}
	},

	disconnect: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'team:*');
		const hotelId = event.locals.hotel!.id;
		await removeConnection(hotelId);
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'hr.disconnect',
			entityType: 'hr_connection',
			entityId: hotelId
		});
		return { ok: 'Disconnected. Existing logins keep working; they just stop following HR.' };
	},

	/** Runs the same check the background job runs, so an admin can see it work. */
	syncNow: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'team:*');
		const result = await syncHrLinkedMembers(event.locals.hotel!.id);
		if (!result.connected) return fail(400, { error: 'Connect to HR first.' });
		if (result.error) return fail(400, { error: result.error });
		const parts = [`Checked ${result.checked} linked login${result.checked === 1 ? '' : 's'}.`];
		if (result.removed.length) {
			parts.push(`Removed access for ${result.removed.map((r) => r.email).join(', ')}.`);
		}
		if (result.protectedKept.length) {
			parts.push(
				`${result.protectedKept.map((r) => r.email).join(', ')} ${result.protectedKept.length === 1 ? 'is' : 'are'} no longer on HR's list but ${result.protectedKept.length === 1 ? 'is' : 'are'} a hotel admin — left in place.`
			);
		}
		if (result.unknown) parts.push(`${result.unknown} not recognised by HR (left alone).`);
		return { ok: parts.join(' ') };
	}
};
