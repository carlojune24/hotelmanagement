import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { listEstablishments } from '$lib/server/establishments';
import { UserError, createUser, listUsers, resetPassword, updateUser } from '$lib/server/users';
import { createUserSchema, resetPasswordSchema, updateUserSchema } from '$lib/user-schema';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.access, 'user:*');
	const [users, ests] = await Promise.all([listUsers(), listEstablishments()]);
	return {
		users,
		establishments: ests.map((e) => ({ id: e.id, name: e.name, status: e.status })),
		selfId: locals.user!.id
	};
};

/** Form fields -> object, with `establishmentIds` collected from repeated checkboxes. */
async function readForm(request: Request) {
	const fd = await request.formData();
	const obj: Record<string, unknown> = Object.fromEntries(fd);
	obj.establishmentIds = fd.getAll('establishmentIds').map(String);
	return obj;
}

// Passwords are never echoed back to the client.
const safe = (values: Record<string, unknown>) => ({ ...values, password: undefined });

export const actions: Actions = {
	create: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'user:*');
		const values = await readForm(request);
		const parsed = createUserSchema.safeParse(values);
		if (!parsed.success) {
			return fail(400, { action: 'create', errors: z.flattenError(parsed.error).fieldErrors, values: safe(values) });
		}
		try {
			const user = await createUser(parsed.data);
			await writeAudit({
				actor: locals.user,
				action: 'user.create',
				entityType: 'user',
				entityId: user.id,
				after: { email: user.email, role: parsed.data.role, establishmentIds: parsed.data.establishmentIds }
			});
		} catch (e) {
			if (e instanceof UserError) return fail(400, { action: 'create', message: e.message, values: safe(values) });
			throw e;
		}
		return { ok: 'Account created. Share the password with them privately.' };
	},

	update: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'user:*');
		const values = await readForm(request);
		const parsed = updateUserSchema.safeParse(values);
		if (!parsed.success) {
			return fail(400, { action: 'update', errors: z.flattenError(parsed.error).fieldErrors, values });
		}
		try {
			await updateUser(locals.user!.id, parsed.data);
			await writeAudit({
				actor: locals.user,
				action: 'user.update',
				entityType: 'user',
				entityId: parsed.data.id,
				after: {
					status: parsed.data.status,
					role: parsed.data.role,
					establishmentIds: parsed.data.establishmentIds
				}
			});
		} catch (e) {
			if (e instanceof UserError) return fail(400, { action: 'update', message: e.message, values });
			throw e;
		}
		return { ok: 'Account updated.' };
	},

	resetPassword: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'user:*');
		const values = await readForm(request);
		const parsed = resetPasswordSchema.safeParse(values);
		if (!parsed.success) {
			return fail(400, { action: 'reset', errors: z.flattenError(parsed.error).fieldErrors });
		}
		try {
			const row = await resetPassword(parsed.data.id, parsed.data.password);
			await writeAudit({
				actor: locals.user,
				action: 'user.reset_password',
				entityType: 'user',
				entityId: row.id
			});
		} catch (e) {
			if (e instanceof UserError) return fail(400, { action: 'reset', message: e.message });
			throw e;
		}
		return { ok: 'Password reset. They are signed out everywhere.' };
	}
};
