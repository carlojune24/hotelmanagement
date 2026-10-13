import { fail } from '@sveltejs/kit';
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { invites, memberships, roles, users } from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { createInvite, revokeInvite } from '$lib/server/auth/invite';
import { sendStaffInvite } from '$lib/server/email/send-invite';
import { HrLinkError, fetchAssigned, getConnection, type HrPerson } from '$lib/server/hr-link/client';
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
			isProtected: roles.isProtected,
			personRef: memberships.personRef
		})
		.from(memberships)
		.innerJoin(users, eq(users.id, memberships.userId))
		.innerJoin(roles, eq(roles.id, memberships.roleId))
		.where(eq(memberships.hotelId, hotelId));

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
	const pendingRefs = (
		await db
			.select({ r: invites.personRef })
			.from(invites)
			.where(and(eq(invites.hotelId, hotelId), eq(invites.status, 'pending')))
	).map((x) => x.r);

	// The HR picker: who HR has assigned to this hotel and who has no login here yet. HR being
	// down or not connected only removes the picker — inviting by email still works as before.
	const connection = await getConnection(hotelId);
	let hrPeople: HrPerson[] = [];
	let hrError: string | null = null;
	if (connection) {
		try {
			const taken = new Set([
				...members.map((m) => m.personRef).filter((r): r is string => !!r),
				...pendingRefs.map((r) => r).filter((r): r is string => !!r)
			]);
			hrPeople = (await fetchAssigned(hotelId)).filter((p) => p.status === 'active' && !taken.has(p.person_ref));
		} catch (e) {
			if (!(e instanceof HrLinkError)) throw e;
			hrError = e.message;
		}
	}

	return {
		members,
		pendingInvites,
		assignableRoles,
		hr: { connected: !!connection, people: hrPeople, error: hrError }
	};
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
			.object({
				email: z.string().email(),
				role: z.string().min(1),
				personRef: z.string().max(64).optional().or(z.literal(''))
			})
			.safeParse(Object.fromEntries(fd));
		if (!parsed.success) return fail(400, { error: 'Enter a valid email and role.' });

		// Re-validated server-side, not just hidden in the UI — this is the actual boundary
		// stopping a hotel from granting itself hotel_admin through this screen.
		const role = await getAssignableRoleOr400(hotelId, parsed.data.role);
		if (!role) return fail(400, { error: 'Choose a valid role.' });

		// An invite from the HR picker is checked against HR *now*, server-side — the browser's word
		// that "this person is one of ours" is never enough to attach a person reference.
		let personRef: string | null = null;
		if (parsed.data.personRef) {
			try {
				const match = (await fetchAssigned(hotelId)).find((p) => p.person_ref === parsed.data.personRef);
				if (!match || match.status !== 'active') {
					return fail(400, { error: 'HR no longer lists that person as active at this hotel.' });
				}
				personRef = match.person_ref;
			} catch (e) {
				if (e instanceof HrLinkError) return fail(400, { error: `Couldn't check with HR: ${e.message}` });
				throw e;
			}
			const already = await db
				.select({ userId: memberships.userId })
				.from(memberships)
				.where(and(eq(memberships.hotelId, hotelId), eq(memberships.personRef, personRef)))
				.then((r) => r.at(0));
			if (already) return fail(400, { error: 'That person already has a login at this hotel.' });
		}

		const { token } = await createInvite({
			email: parsed.data.email,
			hotelId,
			role: role.slug,
			personRef,
			invitedByUserId: event.locals.user?.id
		});
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'team.invite_member',
			entityType: 'invite',
			after: { email: parsed.data.email, role: role.slug, personRef }
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
		if (typeof id !== 'string' || !z.string().uuid().safeParse(id).success)
			return fail(400, { error: 'Missing invite.' });

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

	// Attaches an HR employee to an *existing* login — role and password are untouched, which is
	// why this isn't done by re-inviting (that would reset a hotel admin's role and password).
	linkMember: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'team:*');
		const hotelId = event.locals.hotel!.id;

		const parsed = z
			.object({ userId: z.string().uuid(), personRef: z.string().min(1).max(64) })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Choose an HR employee to link.' });

		const member = await db
			.select({ personRef: memberships.personRef })
			.from(memberships)
			.where(and(eq(memberships.hotelId, hotelId), eq(memberships.userId, parsed.data.userId)))
			.then((r) => r.at(0));
		if (!member) return fail(400, { error: 'Member not found.' });
		if (member.personRef) return fail(400, { error: 'That login is already linked. Unlink it first.' });

		try {
			const match = (await fetchAssigned(hotelId)).find((p) => p.person_ref === parsed.data.personRef);
			if (!match || match.status !== 'active') {
				return fail(400, { error: 'HR no longer lists that person as active at this hotel.' });
			}
		} catch (e) {
			if (e instanceof HrLinkError) return fail(400, { error: `Couldn't check with HR: ${e.message}` });
			throw e;
		}

		const taken = await db
			.select({ userId: memberships.userId })
			.from(memberships)
			.where(and(eq(memberships.hotelId, hotelId), eq(memberships.personRef, parsed.data.personRef)))
			.then((r) => r.at(0));
		if (taken) return fail(400, { error: 'That person already has a login at this hotel.' });

		await db
			.update(memberships)
			.set({ personRef: parsed.data.personRef })
			.where(and(eq(memberships.hotelId, hotelId), eq(memberships.userId, parsed.data.userId)));
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'team.hr_link',
			entityType: 'membership',
			entityId: parsed.data.userId,
			after: { personRef: parsed.data.personRef }
		});
		return { ok: 'Linked to the HR employee.' };
	},

	unlinkMember: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'team:*');
		const hotelId = event.locals.hotel!.id;

		const userId = z.string().uuid().safeParse((await event.request.formData()).get('userId'));
		if (!userId.success) return fail(400, { error: 'Invalid user.' });

		const [before] = await db
			.select({ personRef: memberships.personRef })
			.from(memberships)
			.where(and(eq(memberships.hotelId, hotelId), eq(memberships.userId, userId.data)));
		if (!before) return fail(400, { error: 'Member not found.' });

		await db
			.update(memberships)
			.set({ personRef: null })
			.where(and(eq(memberships.hotelId, hotelId), eq(memberships.userId, userId.data)));
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'team.hr_unlink',
			entityType: 'membership',
			entityId: userId.data,
			before: { personRef: before.personRef }
		});
		return { ok: 'Unlinked from HR.' };
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
