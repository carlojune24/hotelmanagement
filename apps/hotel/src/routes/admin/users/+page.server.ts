import { fail } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { users } from '$lib/server/db/schema/index';
import { writeAudit } from '$lib/server/audit';
import { createInvite } from '$lib/server/auth/invite';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const rows = await db
		.select({
			id: users.id,
			name: users.name,
			email: users.email,
			isPlatformAdmin: users.isPlatformAdmin,
			status: users.status,
			createdAt: users.createdAt
		})
		.from(users)
		.orderBy(asc(users.email));
	return { users: rows };
};

export const actions: Actions = {
	invitePlatformAdmin: async (event) => {
		const email = z
			.string()
			.email()
			.safeParse((await event.request.formData()).get('email'));
		if (!email.success) return fail(400, { error: 'Enter a valid email.' });

		const { token } = await createInvite({
			email: email.data,
			hotelId: null,
			role: null,
			invitedByUserId: event.locals.user?.id
		});
		await writeAudit({
			actor: event.locals.user,
			action: 'user.invite_platform_admin',
			entityType: 'invite',
			after: { email: email.data }
		});
		return { ok: 'Invite created.', inviteLink: `${event.url.origin}/auth/accept-invite/${token}` };
	},

	setStatus: async (event) => {
		const fd = await event.request.formData();
		const parsed = z
			.object({ userId: z.string().uuid(), status: z.enum(['active', 'disabled']) })
			.safeParse(Object.fromEntries(fd));
		if (!parsed.success) return fail(400, { error: 'Invalid request.' });
		if (parsed.data.userId === event.locals.user?.id) {
			return fail(400, { error: 'You cannot change your own status.' });
		}

		await db
			.update(users)
			.set({ status: parsed.data.status, updatedAt: new Date() })
			.where(eq(users.id, parsed.data.userId));
		await writeAudit({
			actor: event.locals.user,
			action: 'user.set_status',
			entityType: 'user',
			entityId: parsed.data.userId,
			after: { status: parsed.data.status }
		});
		return { ok: 'User updated.' };
	}
};
