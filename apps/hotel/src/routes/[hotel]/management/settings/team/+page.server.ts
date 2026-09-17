import { fail } from '@sveltejs/kit';
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { invites, memberships, roles, users } from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { createInvite, revokeInvite } from '$lib/server/auth/invite';
import { sendStaffInvite } from '$lib/server/email/send-invite';
import { linkMemberToEmployee, listEmployeesForLinking } from '$lib/server/hr/employees';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'team:*');
	const hotelId = locals.hotel!.id;

	// hotel_admin is granted only by a platform admin (`/admin/hotels/[hotelId]`) — never
	// offered here, so a hotel can't hand out full access to itself from this screen.
	const assignableRoles = await db
		.select({ id: roles.id, slug: roles.slug, name: roles.name })
		.from(roles)
		.where(and(eq(roles.hotelId, hotelId), eq(roles.isProtected, false)));

	const members = await db
		.select({
			userId: users.id,
			name: users.name,
			email: users.email,
			status: users.status,
			roleId: roles.id,
			roleSlug: roles.slug,
			roleName: roles.name,
			isProtected: roles.isProtected
		})
		.from(memberships)
		.innerJoin(users, eq(users.id, memberships.userId))
		.innerJoin(roles, eq(roles.id, memberships.roleId))
		.where(eq(memberships.hotelId, hotelId));

	// For each member's own "Linked employee" picker — every HR employee record,
	// each already flagged with whichever member (if any) currently holds it.
	const employees = await listEmployeesForLinking(hotelId);

	// Excludes pending hotel_admin invites (created from the platform /admin console) — those
	// belong to that console's own pending-invites list, not this self-service screen.
	const pendingInvites = await db
		.select({
			id: invites.id,
			email: invites.email,
			role: invites.role,
			expiresAt: invites.expiresAt
		})
		.from(invites)
		.where(
			and(eq(invites.hotelId, hotelId), eq(invites.status, 'pending'), ne(invites.role, 'hotel_admin'))
		);

	return { members, pendingInvites, assignableRoles, employees };
};

async function getAssignableRoleOr400(hotelId: string, slug: string) {
	const role = await db
		.select({ id: roles.id, slug: roles.slug })
		.from(roles)
		.where(and(eq(roles.hotelId, hotelId), eq(roles.slug, slug), eq(roles.isProtected, false)))
		.then((r) => r.at(0));
	return role ?? null;
}

export const actions: Actions = {
	inviteMember: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'team:*');
		const hotelId = event.locals.hotel!.id;

		const fd = await event.request.formData();
		const parsed = z
			.object({ email: z.string().email(), role: z.string().min(1) })
			.safeParse(Object.fromEntries(fd));
		if (!parsed.success) return fail(400, { error: 'Enter a valid email and role.' });

		// Re-validated server-side, not just hidden in the UI — this is the actual boundary
		// stopping a hotel from granting itself hotel_admin through this screen.
		const role = await getAssignableRoleOr400(hotelId, parsed.data.role);
		if (!role) return fail(400, { error: 'Choose a valid role.' });

		const { token } = await createInvite({
			email: parsed.data.email,
			hotelId,
			role: role.slug,
			invitedByUserId: event.locals.user?.id
		});
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'team.invite_member',
			entityType: 'invite',
			after: { email: parsed.data.email, role: role.slug }
		});

		const link = `${event.url.origin}/auth/accept-invite/${token}`;
		const roleRow = await db.select({ name: roles.name }).from(roles).where(eq(roles.id, role.id)).then((r) => r[0]);
		const emailed = await sendStaffInvite({
			hotelId,
			hotelName: event.locals.hotel!.name,
			toEmail: parsed.data.email,
			roleName: roleRow?.name ?? role.slug,
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
		requireCap(event.locals.user, event.locals.role, 'team:*');
		const hotelId = event.locals.hotel!.id;

		const fd = await event.request.formData();
		const id = fd.get('id');
		if (typeof id !== 'string') return fail(400, { error: 'Missing invite.' });

		await revokeInvite(id, hotelId);
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'team.revoke_invite',
			entityType: 'invite',
			entityId: id
		});
		return { ok: 'Invite cancelled.' };
	},

	changeRole: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'team:*');
		const hotelId = event.locals.hotel!.id;

		const fd = await event.request.formData();
		const parsed = z
			.object({ userId: z.string().uuid(), role: z.string().min(1) })
			.safeParse(Object.fromEntries(fd));
		if (!parsed.success) return fail(400, { error: 'Invalid role change.' });

		const role = await getAssignableRoleOr400(hotelId, parsed.data.role);
		if (!role) return fail(400, { error: 'Choose a valid role.' });

		await db
			.update(memberships)
			.set({ roleId: role.id })
			.where(and(eq(memberships.hotelId, hotelId), eq(memberships.userId, parsed.data.userId)));
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'team.change_role',
			entityType: 'membership',
			entityId: parsed.data.userId,
			after: { role: role.slug }
		});
		return { ok: 'Role updated.' };
	},

	linkEmployee: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'team:*');
		const hotelId = event.locals.hotel!.id;

		const fd = await event.request.formData();
		const parsed = z
			.object({ userId: z.string().uuid(), employeeId: z.string().uuid().optional().or(z.literal('')) })
			.safeParse(Object.fromEntries(fd));
		if (!parsed.success) return fail(400, { error: 'Invalid link.' });

		await linkMemberToEmployee(hotelId, parsed.data.userId, parsed.data.employeeId || null);
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'employee.link_user',
			entityType: 'membership',
			entityId: parsed.data.userId,
			after: { employeeId: parsed.data.employeeId || null }
		});
		return { ok: parsed.data.employeeId ? 'Linked to an employee record.' : 'Unlinked.' };
	},

	removeMember: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'team:*');
		const hotelId = event.locals.hotel!.id;

		const fd = await event.request.formData();
		const userId = z.string().uuid().safeParse(fd.get('userId'));
		if (!userId.success) return fail(400, { error: 'Invalid user.' });

		// Never lets this screen remove a hotel_admin — that stays a platform-admin-only
		// action (`/admin/hotels/[hotelId]`), so a hotel can't lock itself out from here.
		const membership = await db
			.select({ isProtected: roles.isProtected })
			.from(memberships)
			.innerJoin(roles, eq(roles.id, memberships.roleId))
			.where(and(eq(memberships.hotelId, hotelId), eq(memberships.userId, userId.data)))
			.then((r) => r.at(0));
		if (!membership) return fail(400, { error: 'Member not found.' });
		if (membership.isProtected) {
			return fail(400, { error: 'Hotel admin access can only be revoked by a platform admin.' });
		}

		await db
			.delete(memberships)
			.where(and(eq(memberships.hotelId, hotelId), eq(memberships.userId, userId.data)));
		// The membership is gone, but the `users` row (and any employee link to it)
		// isn't — clear it too, so no employee is left showing as "linked" to someone
		// who's no longer part of this hotel.
		await linkMemberToEmployee(hotelId, userId.data, null);
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'team.remove_member',
			entityType: 'membership',
			entityId: userId.data
		});
		return { ok: 'Member removed.' };
	}
};
