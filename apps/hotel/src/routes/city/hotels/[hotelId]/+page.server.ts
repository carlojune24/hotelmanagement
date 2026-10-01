import { error, fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { hotels, invites, memberships, roles, users } from '$lib/server/db/schema/index';
import { writeAudit } from '$lib/server/audit';
import { createInvite, revokeInvite } from '$lib/server/auth/invite';
import { sendStaffInvite } from '$lib/server/email/send-invite';
import { requirePlatformAdmin } from '$lib/server/auth/rbac';
import { slugError } from '$lib/server/tenant';
import type { Actions, PageServerLoad } from './$types';

/** Platform admin only ever grants/revokes the protected `hotel_admin` role here — every
 *  other role is invited/managed by a hotel's own hotel_admin from inside the hotel
 *  (`[hotel]/management/settings/team`). */
const HOTEL_ADMIN_SLUG = 'hotel_admin';

export const load: PageServerLoad = async ({ params }) => {
	const hotel = await db
		.select()
		.from(hotels)
		.where(eq(hotels.id, params.hotelId))
		.then((r) => r.at(0));
	if (!hotel) error(404, 'Hotel not found');

	const members = await db
		.select({
			userId: users.id,
			name: users.name,
			email: users.email,
			roleSlug: roles.slug,
			status: users.status
		})
		.from(memberships)
		.innerJoin(users, eq(users.id, memberships.userId))
		.innerJoin(roles, eq(roles.id, memberships.roleId))
		.where(and(eq(memberships.hotelId, hotel.id), eq(roles.slug, HOTEL_ADMIN_SLUG)));

	const pendingInvites = await db
		.select({
			id: invites.id,
			email: invites.email,
			role: invites.role,
			expiresAt: invites.expiresAt
		})
		.from(invites)
		.where(
			and(
				eq(invites.hotelId, hotel.id),
				eq(invites.status, 'pending'),
				eq(invites.role, HOTEL_ADMIN_SLUG)
			)
		);

	return { hotel, members, pendingInvites };
};

const configSchema = z.object({
	name: z.string().min(2).max(160),
	/** Bare hostname only — no protocol, no path, no port. Empty clears the mapping. */
	customDomain: z
		.string()
		.max(255)
		.regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i, 'Enter a bare domain, e.g. mmhotel.com — no https:// or path')
		.optional()
		.or(z.literal(''))
});

async function getHotelOr404(id: string) {
	const h = await db
		.select()
		.from(hotels)
		.where(eq(hotels.id, id))
		.then((r) => r.at(0));
	if (!h) error(404, 'Hotel not found');
	return h;
}

export const actions: Actions = {
	updateConfig: async (event) => {
		requirePlatformAdmin(event.locals.user);
		const parsed = configSchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Check the configuration fields.' });
		const before = await getHotelOr404(event.params.hotelId!);
		const d = parsed.data;

		try {
			await db
				.update(hotels)
				.set({
					name: d.name.trim(),
					customDomain: d.customDomain?.trim().toLowerCase() || null,
					updatedAt: new Date()
				})
				.where(eq(hotels.id, before.id));
		} catch (e) {
			if (e instanceof Error && 'code' in e && (e as { code: string }).code === '23505') {
				return fail(400, { error: 'That domain is already mapped to another hotel.' });
			}
			throw e;
		}

		await writeAudit({
			hotelId: before.id,
			actor: event.locals.user,
			action: 'hotel.update_config',
			entityType: 'hotel',
			entityId: before.id,
			before: { name: before.name, customDomain: before.customDomain },
			after: { name: d.name, customDomain: d.customDomain || null }
		});
		return { ok: 'Configuration saved.' };
	},

	updateSlug: async (event) => {
		requirePlatformAdmin(event.locals.user);
		const parsed = z
			.object({ slug: z.string().min(3).max(40) })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Enter a slug.' });

		const slug = parsed.data.slug.toLowerCase().trim();
		const slugErr = slugError(slug);
		if (slugErr) return fail(400, { error: slugErr });

		const before = await getHotelOr404(event.params.hotelId!);
		if (slug === before.slug) return { ok: 'Slug unchanged.' };

		try {
			await db.update(hotels).set({ slug, updatedAt: new Date() }).where(eq(hotels.id, before.id));
		} catch (e) {
			if (e instanceof Error && 'code' in e && (e as { code: string }).code === '23505') {
				return fail(400, { error: `The slug "${slug}" is already taken.` });
			}
			throw e;
		}

		await writeAudit({
			hotelId: before.id,
			actor: event.locals.user,
			action: 'hotel.update_slug',
			entityType: 'hotel',
			entityId: before.id,
			before: { slug: before.slug },
			after: { slug }
		});
		return {
			ok: `Slug changed to /${slug}. Any links already sent to guests under /${before.slug} (confirmation, manage-booking, reviews) will now 404.`
		};
	},

	setStatus: async (event) => {
		requirePlatformAdmin(event.locals.user);
		const fd = await event.request.formData();
		const status = z.enum(['draft', 'published', 'archived']).safeParse(fd.get('status'));
		if (!status.success) return fail(400, { error: 'Invalid status.' });
		const hotel = await getHotelOr404(event.params.hotelId!);

		await db
			.update(hotels)
			.set({ status: status.data, updatedAt: new Date() })
			.where(eq(hotels.id, hotel.id));
		await writeAudit({
			hotelId: hotel.id,
			actor: event.locals.user,
			action: 'hotel.set_status',
			entityType: 'hotel',
			entityId: hotel.id,
			before: { status: hotel.status },
			after: { status: status.data }
		});
		return { ok: `Hotel is now ${status.data}.` };
	},

	inviteMember: async (event) => {
		requirePlatformAdmin(event.locals.user);
		const fd = await event.request.formData();
		const parsed = z.object({ email: z.string().email() }).safeParse(Object.fromEntries(fd));
		if (!parsed.success) return fail(400, { error: 'Enter a valid email.' });
		const hotel = await getHotelOr404(event.params.hotelId!);

		const { token } = await createInvite({
			email: parsed.data.email,
			hotelId: hotel.id,
			role: HOTEL_ADMIN_SLUG,
			invitedByUserId: event.locals.user?.id
		});
		await writeAudit({
			hotelId: hotel.id,
			actor: event.locals.user,
			action: 'hotel.invite_member',
			entityType: 'invite',
			after: { email: parsed.data.email, role: HOTEL_ADMIN_SLUG }
		});

		const link = `${event.url.origin}/auth/accept-invite/${token}`;
		const emailed = await sendStaffInvite({
			hotelId: hotel.id,
			hotelName: hotel.name,
			toEmail: parsed.data.email,
			roleName: 'Hotel Admin',
			inviteUrl: link,
			inviterName: event.locals.user?.name ?? null,
			expiresInDays: 7
		});
		return {
			ok: emailed.ok ? 'Invite created and emailed.' : 'Invite created, but the email failed to send.',
			inviteLink: link
		};
	},

	revokeInvite: async (event) => {
		requirePlatformAdmin(event.locals.user);
		const fd = await event.request.formData();
		const id = fd.get('id');
		if (typeof id !== 'string') return fail(400, { error: 'Missing invite.' });
		const hotel = await getHotelOr404(event.params.hotelId!);

		await revokeInvite(id, hotel.id);
		await writeAudit({
			hotelId: hotel.id,
			actor: event.locals.user,
			action: 'hotel.revoke_invite',
			entityType: 'invite',
			entityId: id
		});
		return { ok: 'Invite cancelled.' };
	},

	removeMember: async (event) => {
		requirePlatformAdmin(event.locals.user);
		const fd = await event.request.formData();
		const userId = z.string().uuid().safeParse(fd.get('userId'));
		if (!userId.success) return fail(400, { error: 'Invalid user.' });
		const hotel = await getHotelOr404(event.params.hotelId!);

		await db
			.delete(memberships)
			.where(and(eq(memberships.hotelId, hotel.id), eq(memberships.userId, userId.data)));
		await writeAudit({
			hotelId: hotel.id,
			actor: event.locals.user,
			action: 'hotel.remove_member',
			entityType: 'membership',
			entityId: userId.data
		});
		return { ok: 'Member removed.' };
	}
};
