import { fail } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { apiKeys, establishments } from '$lib/server/db/schema/index';
import { canAt } from '$lib/authz';
import { issueApiKey, revokeApiKey } from '$lib/server/auth/api-key';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import {
	mergeNightDiffIntoConfig,
	nightDiffSchema,
	parseNightDiff
} from '$lib/server/hr/night-diff';
import type { Actions, PageServerLoad } from './$types';

/** The establishment's pay rules are Main HR's to change; its managers and clerks only read them. */
const mayEditNightDiff = (locals: App.Locals, establishmentId: string) =>
	locals.user!.isSystemAdmin || canAt(locals.access!, 'establishment:write', establishmentId);

/** Keys are Main HR's to issue — org-wide only, never a manager's, even for their own business. */
const mayManageKeys = (locals: App.Locals) =>
	locals.user!.isSystemAdmin || canAt(locals.access!, 'apikey:*');

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.access, 'schedule:*', locals.establishment!.id);
const canKeys = mayManageKeys(locals);
	// Managers and clerks see the night differential; only Main HR changes it.
	const canEditNightDiff = mayEditNightDiff(locals, locals.establishment!.id);
	const keys = canKeys
		? await db
				.select({
					id: apiKeys.id,
					name: apiKeys.name,
					prefix: apiKeys.keyPrefix,
					createdAt: apiKeys.createdAt,
					lastUsedAt: apiKeys.lastUsedAt,
					revokedAt: apiKeys.revokedAt
				})
				.from(apiKeys)
				.where(eq(apiKeys.establishmentId, locals.establishment!.id))
				.orderBy(desc(apiKeys.createdAt))
		: [];
	return {
		nightDiff: parseNightDiff(locals.establishment!.config),
canEditNightDiff,
canKeys,
		keys
	};
};

export const actions: Actions = {
	saveNightDiff: async (event) => {
const establishment = event.locals.establishment!;
if (!mayEditNightDiff(event.locals, establishment.id)) {
return fail(403, { error: 'Only Main HR can change the night differential.' });
}
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = nightDiffSchema.safeParse(raw);
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the night differential.' });
		}
		const before = parseNightDiff(establishment.config);
		await db
			.update(establishments)
			.set({ config: mergeNightDiffIntoConfig(establishment.config, parsed.data), updatedAt: new Date() })
			.where(eq(establishments.id, establishment.id));
		await writeAudit({
			establishmentId: establishment.id,
			actor: event.locals.user,
			action: 'hr.night_diff.update',
			entityType: 'establishment',
			entityId: establishment.id,
			before,
			after: parsed.data
		});
		return { ok: 'Night differential saved.' };
	},

	/** Issues a key for this establishment. The raw value is returned once and never stored. */
	createKey: async (event) => {
		if (!mayManageKeys(event.locals)) return fail(403, { error: 'Only Main HR can issue keys.' });
		const est = event.locals.establishment!;
		const name = z.string().trim().min(1).max(80).safeParse(String((await event.request.formData()).get('name') ?? ''));
		if (!name.success) return fail(400, { error: 'Name the key, e.g. “Hotel app”.' });
		const { raw, key } = await issueApiKey({
			establishmentId: est.id,
			name: name.data,
			createdByUserId: event.locals.user!.id
		});
		await writeAudit({
			establishmentId: est.id,
			actor: event.locals.user,
			action: 'apikey.create',
			entityType: 'api_key',
			entityId: key.id,
			after: { name: name.data, prefix: key.keyPrefix }
		});
		return { ok: 'Key created. Copy it now — it is not shown again.', newKey: raw };
	},

	revokeKey: async (event) => {
		if (!mayManageKeys(event.locals)) return fail(403, { error: 'Only Main HR can revoke keys.' });
		const est = event.locals.establishment!;
		const id = z.string().uuid().safeParse((await event.request.formData()).get('id'));
		if (!id.success) return fail(400, { error: 'Unknown key.' });
		// Scoped to this establishment, so a key id from another business can never be revoked here.
		const owned = await db
			.select({ id: apiKeys.id })
			.from(apiKeys)
			.where(and(eq(apiKeys.id, id.data), eq(apiKeys.establishmentId, est.id)))
			.then((r) => r.at(0));
		if (!owned) return fail(404, { error: 'That key is not on this establishment.' });
		await revokeApiKey(id.data);
		await writeAudit({
			establishmentId: est.id,
			actor: event.locals.user,
			action: 'apikey.revoke',
			entityType: 'api_key',
			entityId: id.data
		});
		return { ok: 'Key revoked.' };
	}
};
