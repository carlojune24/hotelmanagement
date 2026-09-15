import { sha256 } from '@oslojs/crypto/sha2';
import { encodeBase32LowerCaseNoPadding, encodeHexLowerCase } from '@oslojs/encoding';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { invites, memberships, roles, users } from '$lib/server/db/schema/index';
import { hashPassword } from './password';

const DAY = 1000 * 60 * 60 * 24;

export function generateInviteToken(): string {
	return encodeBase32LowerCaseNoPadding(crypto.getRandomValues(new Uint8Array(32)));
}

function hashInviteToken(token: string): string {
	return encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
}

export async function createInvite(input: {
	email: string;
	hotelId?: string | null;
	/** A role *slug* (see `roles.slug`) — hotelId: null (platform admin) invites pass null. */
	role?: string | null;
	invitedByUserId?: string | null;
	ttlDays?: number;
}): Promise<{ token: string; id: string }> {
	const email = input.email.toLowerCase();
	const hotelId = input.hotelId ?? null;

	// Re-inviting the same email to the same hotel (or platform, for hotelId: null)
	// supersedes any invite already pending — otherwise it just piles up duplicates
	// in the "Pending invites" list, all resolving to the same person.
	await db
		.update(invites)
		.set({ status: 'revoked' })
		.where(
			and(
				eq(invites.email, email),
				hotelId === null ? isNull(invites.hotelId) : eq(invites.hotelId, hotelId),
				eq(invites.status, 'pending')
			)
		);

	const token = generateInviteToken();
	const [row] = await db
		.insert(invites)
		.values({
			email,
			tokenHash: hashInviteToken(token),
			hotelId,
			role: input.role ?? null,
			invitedByUserId: input.invitedByUserId ?? null,
			expiresAt: new Date(Date.now() + (input.ttlDays ?? 7) * DAY)
		})
		.returning({ id: invites.id });
	return { token, id: row!.id };
}

/** Cancels a pending invite so its link no longer works. A no-op (not an error)
 *  if it was already accepted/expired/revoked. */
export async function revokeInvite(id: string, hotelId: string | null): Promise<void> {
	await db
		.update(invites)
		.set({ status: 'revoked' })
		.where(
			and(
				eq(invites.id, id),
				hotelId === null ? isNull(invites.hotelId) : eq(invites.hotelId, hotelId),
				eq(invites.status, 'pending')
			)
		);
}

export async function getUsableInvite(token: string) {
	const row = await db
		.select()
		.from(invites)
		.where(and(eq(invites.tokenHash, hashInviteToken(token)), eq(invites.status, 'pending')))
		.then((r) => r.at(0));
	if (!row) return null;
	if (Date.now() >= row.expiresAt.getTime()) {
		await db.update(invites).set({ status: 'expired' }).where(eq(invites.id, row.id));
		return null;
	}
	return row;
}

/** Create or update the user for an invite, apply access, mark it accepted. */
export async function acceptInvite(
	token: string,
	profile: { name: string; password: string }
): Promise<{ userId: string } | { error: string }> {
	const invite = await getUsableInvite(token);
	if (!invite) return { error: 'This invite link is invalid or has expired.' };

	const passwordHash = await hashPassword(profile.password);
	const email = invite.email.toLowerCase();

	try {
		return await db.transaction(async (tx) => {
			const existing = await tx
				.select()
				.from(users)
				.where(eq(users.email, email))
				.then((r) => r.at(0));

			let userId: string;
			if (existing) {
				userId = existing.id;
				await tx
					.update(users)
					.set({
						name: profile.name,
						passwordHash,
						status: 'active',
						isPlatformAdmin: existing.isPlatformAdmin || invite.hotelId === null,
						updatedAt: new Date()
					})
					.where(eq(users.id, userId));
			} else {
				const [created] = await tx
					.insert(users)
					.values({
						email,
						name: profile.name,
						passwordHash,
						isPlatformAdmin: invite.hotelId === null
					})
					.returning({ id: users.id });
				userId = created!.id;
			}

			if (invite.hotelId && invite.role) {
				// `invite.role` stores a role *slug* (stable across a role rename) — resolve it
				// to the hotel's current role row. If the role was deleted between invite
				// creation and acceptance, throw so the transaction rolls back the user
				// create/update above too, rather than leaving a dangling user with no membership.
				const role = await tx
					.select({ id: roles.id })
					.from(roles)
					.where(and(eq(roles.hotelId, invite.hotelId), eq(roles.slug, invite.role)))
					.then((r) => r.at(0));
				if (!role) throw new InviteRoleGoneError();

				await tx
					.insert(memberships)
					.values({
						userId,
						hotelId: invite.hotelId,
						roleId: role.id
					})
					.onConflictDoUpdate({
						target: [memberships.userId, memberships.hotelId],
						set: { roleId: role.id }
					});
			}

			await tx
				.update(invites)
				.set({ status: 'accepted', acceptedAt: new Date() })
				.where(eq(invites.id, invite.id));

			return { userId };
		});
	} catch (e) {
		if (e instanceof InviteRoleGoneError) {
			return { error: 'This invite refers to a role that no longer exists. Ask for a new invite.' };
		}
		throw e;
	}
}

class InviteRoleGoneError extends Error {}
