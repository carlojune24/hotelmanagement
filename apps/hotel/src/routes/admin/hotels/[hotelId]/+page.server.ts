import { error, fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { hotels, invites, memberships, users } from '$lib/server/db/schema/index';
import { writeAudit } from '$lib/server/audit';
import { createInvite } from '$lib/server/auth/invite';
import type { MembershipRole } from '$lib/server/tenant';
import type { Actions, PageServerLoad } from './$types';

const ROLES: MembershipRole[] = [
	'hotel_admin',
	'front_desk',
	'housekeeping',
	'accountant',
	'hr',
	'read_only'
];

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
			role: memberships.role,
			status: users.status
		})
		.from(memberships)
		.innerJoin(users, eq(users.id, memberships.userId))
		.where(eq(memberships.hotelId, hotel.id));

	const pendingInvites = await db
		.select({ id: invites.id, email: invites.email, role: invites.role, expiresAt: invites.expiresAt })
		.from(invites)
		.where(and(eq(invites.hotelId, hotel.id), eq(invites.status, 'pending')));

	return { hotel, members, pendingInvites, roles: ROLES };
};

const configSchema = z.object({
	name: z.string().min(2).max(160),
	legalName: z.string().max(200).optional(),
	addressLine: z.string().max(240).optional(),
	city: z.string().max(120).optional(),
	timezone: z.string().min(1).max(64),
	currency: z.enum(['PHP']),
	vatRatePct: z.coerce.number().min(0).max(30),
	orSeriesPrefix: z.string().min(1).max(12)
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
		const parsed = configSchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Check the configuration fields.' });
		const before = await getHotelOr404(event.params.hotelId!);
		const d = parsed.data;

		await db
			.update(hotels)
			.set({
				name: d.name.trim(),
				legalName: d.legalName?.trim() || null,
				addressLine: d.addressLine?.trim() || null,
				city: d.city?.trim() || null,
				timezone: d.timezone,
				currency: d.currency,
				vatRateBps: Math.round(d.vatRatePct * 100),
				orSeriesPrefix: d.orSeriesPrefix.trim().toUpperCase(),
				updatedAt: new Date()
			})
			.where(eq(hotels.id, before.id));

		await writeAudit({
			hotelId: before.id,
			actor: event.locals.user,
			action: 'hotel.update_config',
			entityType: 'hotel',
			entityId: before.id,
			before: { name: before.name, vatRateBps: before.vatRateBps },
			after: { name: d.name, vatRateBps: Math.round(d.vatRatePct * 100) }
		});
		return { ok: 'Configuration saved.' };
	},

	setStatus: async (event) => {
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
		const fd = await event.request.formData();
		const parsed = z
			.object({ email: z.string().email(), role: z.enum(ROLES as [string, ...string[]]) })
			.safeParse(Object.fromEntries(fd));
		if (!parsed.success) return fail(400, { error: 'Enter a valid email and role.' });
		const hotel = await getHotelOr404(event.params.hotelId!);

		const { token } = await createInvite({
			email: parsed.data.email,
			hotelId: hotel.id,
			role: parsed.data.role as MembershipRole,
			invitedByUserId: event.locals.user?.id
		});
		await writeAudit({
			hotelId: hotel.id,
			actor: event.locals.user,
			action: 'hotel.invite_member',
			entityType: 'invite',
			after: { email: parsed.data.email, role: parsed.data.role }
		});

		const link = `${event.url.origin}/auth/accept-invite/${token}`;
		return { ok: 'Invite created.', inviteLink: link };
	},

	changeRole: async (event) => {
		const fd = await event.request.formData();
		const parsed = z
			.object({ userId: z.string().uuid(), role: z.enum(ROLES as [string, ...string[]]) })
			.safeParse(Object.fromEntries(fd));
		if (!parsed.success) return fail(400, { error: 'Invalid role change.' });
		const hotel = await getHotelOr404(event.params.hotelId!);

		await db
			.update(memberships)
			.set({ role: parsed.data.role as MembershipRole })
			.where(
				and(eq(memberships.hotelId, hotel.id), eq(memberships.userId, parsed.data.userId))
			);
		await writeAudit({
			hotelId: hotel.id,
			actor: event.locals.user,
			action: 'hotel.change_role',
			entityType: 'membership',
			entityId: parsed.data.userId,
			after: { role: parsed.data.role }
		});
		return { ok: 'Role updated.' };
	},

	removeMember: async (event) => {
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
