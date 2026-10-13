import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { canAt } from '$lib/authz';
import { requireCap, requireCapAnywhere } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import {
	EstablishmentError,
	createEstablishment,
	establishmentSchema,
	listEstablishments,
	updateEstablishment
} from '$lib/server/establishments';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const { user, access } = locals;
	requireCapAnywhere(user, access, 'establishment:read');
	const orgWide = user!.isSystemAdmin || canAt(access!, 'establishment:read');
	// A manager sees only the establishments they hold a role at; org-wide roles see all.
	const rows = await listEstablishments(orgWide ? undefined : Object.keys(access!.establishments));
	return {
		establishments: rows.map((e) => ({
			id: e.id,
			name: e.name,
			kind: e.kind as 'hotel' | 'business',
			timezone: e.timezone,
			status: e.status as 'active' | 'archived',
			orgRef: e.orgRef
		})),
		canWrite: user!.isSystemAdmin || canAt(access!, 'establishment:write')
	};
};

const fd = async (request: Request) => Object.fromEntries(await request.formData());

export const actions: Actions = {
	create: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'establishment:write');
		const values = await fd(request);
		const parsed = establishmentSchema.safeParse(values);
		if (!parsed.success) {
			return fail(400, { action: 'create', errors: z.flattenError(parsed.error).fieldErrors, values });
		}
		try {
			const row = await createEstablishment(parsed.data);
			await writeAudit({
				actor: locals.user,
				action: 'establishment.create',
				entityType: 'establishment',
				entityId: row.id,
				after: { name: row.name, kind: row.kind, orgRef: row.orgRef }
			});
		} catch (e) {
			if (e instanceof EstablishmentError) {
				return fail(400, { action: 'create', message: e.message, values });
			}
			throw e;
		}
		return { ok: 'Establishment added.' };
	},

	update: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'establishment:write');
		const values = await fd(request);
		const parsed = z
			.object({
				id: z.string().uuid(),
				name: z.string().trim().min(1, 'Enter a name.').max(120),
				timezone: establishmentSchema.shape.timezone,
				status: z.enum(['active', 'archived'])
			})
			.safeParse(values);
		if (!parsed.success) {
			return fail(400, { action: 'update', errors: z.flattenError(parsed.error).fieldErrors, values });
		}
		const { id, ...rest } = parsed.data;
		try {
			const row = await updateEstablishment(id, rest);
			await writeAudit({
				actor: locals.user,
				establishmentId: id,
				action: 'establishment.update',
				entityType: 'establishment',
				entityId: id,
				after: { name: row.name, timezone: row.timezone, status: row.status }
			});
		} catch (e) {
			if (e instanceof EstablishmentError) {
				return fail(400, { action: 'update', message: e.message, values });
			}
			throw e;
		}
		return { ok: 'Establishment updated.' };
	}
};
