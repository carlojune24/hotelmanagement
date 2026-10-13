import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { hashOpaqueToken } from '$lib/server/crypto';
import { writeAudit } from '$lib/server/audit';
import { UserError, changeOwnPassword } from '$lib/server/users';
import { changePasswordSchema } from '$lib/user-schema';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	return { name: locals.user!.name, email: locals.user!.email };
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const user = locals.user;
		if (!user || !locals.sessionToken) return fail(401, { message: 'Sign in again.' });

		const parsed = changePasswordSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) {
			return fail(400, { errors: z.flattenError(parsed.error).fieldErrors });
		}
		try {
			await changeOwnPassword(
				user.id,
				hashOpaqueToken(locals.sessionToken),
				parsed.data.current,
				parsed.data.next
			);
		} catch (e) {
			if (e instanceof UserError) return fail(400, { message: e.message });
			throw e;
		}
		await writeAudit({
			actor: user,
			action: 'user.change_password',
			entityType: 'user',
			entityId: user.id
		});
		return { ok: 'Password changed. Other devices were signed out.' };
	}
};
