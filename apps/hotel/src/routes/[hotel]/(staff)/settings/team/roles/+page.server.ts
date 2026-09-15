import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import {
	RoleError,
	createCustomRole,
	deleteCustomRole,
	listRolesWithCaps,
	updateCustomRole
} from '$lib/server/auth/roles';
import { PERMISSION_CATALOG, PERMISSION_SECTIONS } from '$lib/authz';
import type { Actions, PageServerLoad } from './$types';

const ALL_CAPS = new Set(PERMISSION_CATALOG.map((p) => p.cap));

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'team:*');
	const roles = await listRolesWithCaps(locals.hotel!.id);
	return { roles, sections: PERMISSION_SECTIONS, catalog: PERMISSION_CATALOG };
};

const wrap = async (fn: () => Promise<unknown>, ok: string) => {
	try {
		await fn();
		return { ok };
	} catch (e) {
		if (e instanceof RoleError) return fail(400, { error: e.message });
		throw e;
	}
};

/** Only a capability this app actually checks may be granted — a stray/renamed value
 *  posted from a stale form silently drops instead of getting saved as dead weight. */
function parseCapabilities(fd: FormData): string[] {
	return fd.getAll('capabilities').filter((c): c is string => typeof c === 'string' && ALL_CAPS.has(c));
}

export const actions: Actions = {
	createRole: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'team:*');
		const fd = await event.request.formData();
		const parsed = z
			.object({ name: z.string().min(1).max(80), description: z.string().max(300).optional() })
			.safeParse(Object.fromEntries(fd));
		if (!parsed.success) return fail(400, { error: 'Give the role a name.' });

		return wrap(
			() =>
				createCustomRole(
					event.locals.hotel!.id,
					{
						name: parsed.data.name,
						description: parsed.data.description || null,
						capabilities: parseCapabilities(fd)
					},
					event.locals.user
				),
			'Role created.'
		);
	},

	updateRole: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'team:*');
		const fd = await event.request.formData();
		const parsed = z
			.object({
				roleId: z.string().uuid(),
				name: z.string().min(1).max(80),
				description: z.string().max(300).optional()
			})
			.safeParse(Object.fromEntries(fd));
		if (!parsed.success) return fail(400, { error: 'Check the role fields.' });

		return wrap(
			() =>
				updateCustomRole(
					event.locals.hotel!.id,
					parsed.data.roleId,
					{
						name: parsed.data.name,
						description: parsed.data.description || null,
						capabilities: parseCapabilities(fd)
					},
					event.locals.user
				),
			'Role updated.'
		);
	},

	deleteRole: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'team:*');
		const fd = await event.request.formData();
		const roleId = fd.get('roleId');
		if (typeof roleId !== 'string') return fail(400, { error: 'Missing role.' });

		return wrap(() => deleteCustomRole(event.locals.hotel!.id, roleId, event.locals.user), 'Role deleted.');
	}
};
