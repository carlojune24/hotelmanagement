import { sha256 } from '@oslojs/crypto/sha2';
import { encodeBase32LowerCaseNoPadding, encodeHexLowerCase } from '@oslojs/encoding';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { invites, memberships, users } from '$lib/server/db/schema/index';
import type { MembershipRole } from '$lib/server/tenant';
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
	role?: MembershipRole | null;
	invitedByUserId?: string | null;
	ttlDays?: number;
}): Promise<{ token: string; id: string }> {
	const token = generateInviteToken();
	const [row] = await db
		.insert(invites)
		.values({
			email: input.email.toLowerCase(),
			tokenHash: hashInviteToken(token),
			hotelId: input.hotelId ?? null,
			role: input.role ?? null,
			invitedByUserId: input.invitedByUserId ?? null,
			expiresAt: new Date(Date.now() + (input.ttlDays ?? 7) * DAY)
		})
		.returning({ id: invites.id });
	return { token, id: row!.id };
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

	return db.transaction(async (tx) => {
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
			await tx
				.insert(memberships)
				.values({
					userId,
					hotelId: invite.hotelId,
					role: invite.role as MembershipRole
				})
				.onConflictDoUpdate({
					target: [memberships.userId, memberships.hotelId],
					set: { role: invite.role as MembershipRole }
				});
		}

		await tx
			.update(invites)
			.set({ status: 'accepted', acceptedAt: new Date() })
			.where(eq(invites.id, invite.id));

		return { userId };
	});
}
