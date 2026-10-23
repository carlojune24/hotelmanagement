import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { hashOpaqueToken } from '$lib/server/crypto';
import { writeAudit } from '$lib/server/audit';
import { db } from '$lib/server/db/index';
import { users } from '$lib/server/db/schema/index';
import { eq } from 'drizzle-orm';
import { verifyPassword } from '$lib/server/auth/password';
import { RECOVERY_COUNT, issueRecoveryCodes, recoverySummary } from '$lib/server/auth/recovery';
import { UserError, changeOwnPassword } from '$lib/server/users';
import { changePasswordSchema } from '$lib/user-schema';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	return {
		name: locals.user!.name,
		email: locals.user!.email,
		recovery: { ...(await recoverySummary(locals.user!.id)), perSet: RECOVERY_COUNT }
	};
};

export const actions: Actions = {
	password: async ({ request, locals }) => {
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
	},

	/** A new set of recovery codes, shown once. They stand in for the emailed code, so the password is asked again. */
	recovery: async ({ request, locals }) => {
		const user = locals.user;
		if (!user) return fail(401, { recoveryError: 'Sign in again.' });
		const current = String((await request.formData()).get('current') ?? '');
		const [row] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, user.id)).limit(1);
		if (!row?.hash || !(await verifyPassword(row.hash, current))) {
			return fail(400, { recoveryError: 'Your current password is not correct.' });
		}
		const codes = await issueRecoveryCodes(user.id);
		await writeAudit({ actor: user, action: 'signin_code.recovery_generated', entityType: 'user', entityId: user.id });
		return { recoveryCodes: codes };
	}
};
