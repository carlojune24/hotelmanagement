import { and, asc, eq, ne } from 'drizzle-orm';
import { db } from './db/index';
import {
	establishmentMemberships,
	establishments,
	orgMemberships,
	sessions,
	users
} from './db/schema/index';
import { hashPassword, verifyPassword } from './auth/password';
import { getOrganization } from './establishments';
import { isOrgRole, removesLastMainHr } from '$lib/user-schema';

export class UserError extends Error {}

export async function listUsers() {
	const [rows, orgRows, estRows] = await Promise.all([
		db.select().from(users).orderBy(asc(users.name)),
		db.select().from(orgMemberships),
		db
			.select({
				userId: establishmentMemberships.userId,
				establishmentId: establishmentMemberships.establishmentId,
				role: establishmentMemberships.role,
				name: establishments.name
			})
			.from(establishmentMemberships)
			.innerJoin(establishments, eq(establishments.id, establishmentMemberships.establishmentId))
	]);
	return rows.map((u) => {
		const org = orgRows.find((m) => m.userId === u.id);
		const mine = estRows.filter((m) => m.userId === u.id);
		return {
			id: u.id,
			name: u.name,
			email: u.email,
			status: u.status as 'active' | 'disabled',
			role: (org?.role ?? mine[0]?.role ?? null) as string | null,
			establishments: mine.map((m) => ({ id: m.establishmentId, name: m.name }))
		};
	});
}

/** Replaces a user's whole access in one go: an org-wide role, or per-establishment roles. */
async function writeAccess(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	userId: string,
	organizationId: string,
	role: string,
	establishmentIds: string[]
) {
	await tx.delete(orgMemberships).where(eq(orgMemberships.userId, userId));
	await tx.delete(establishmentMemberships).where(eq(establishmentMemberships.userId, userId));
	if (isOrgRole(role)) {
		await tx.insert(orgMemberships).values({ userId, organizationId, role });
	} else {
		await tx
			.insert(establishmentMemberships)
			.values(establishmentIds.map((establishmentId) => ({ userId, establishmentId, role })));
	}
}

async function assertEstablishmentsExist(ids: string[]) {
	if (ids.length === 0) return;
	const found = await db.select({ id: establishments.id }).from(establishments);
	const known = new Set(found.map((f) => f.id));
	if (ids.some((id) => !known.has(id))) throw new UserError('One of those establishments no longer exists.');
}

export async function createUser(input: {
	name: string;
	email: string;
	password: string;
	role: string;
	establishmentIds: string[];
}) {
	await assertEstablishmentsExist(input.establishmentIds);
	const org = await getOrganization();
	const taken = await db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.email, input.email))
		.then((r) => r.at(0));
	if (taken) throw new UserError('That email already has an account.');

	const passwordHash = await hashPassword(input.password);
	return db.transaction(async (tx) => {
		const [user] = await tx
			.insert(users)
			.values({ email: input.email, name: input.name, passwordHash })
			.returning();
		await writeAccess(tx, user!.id, org.id, input.role, input.establishmentIds);
		return user!;
	});
}

async function otherActiveMainHrCount(exceptUserId: string): Promise<number> {
	const rows = await db
		.select({ id: users.id })
		.from(orgMemberships)
		.innerJoin(users, eq(users.id, orgMemberships.userId))
		.where(
			and(
				eq(orgMemberships.role, 'main_hr'),
				eq(users.status, 'active'),
				ne(users.id, exceptUserId)
			)
		);
	return rows.length;
}

export async function updateUser(
	actorId: string,
	input: {
		id: string;
		name: string;
		status: 'active' | 'disabled';
		role: string;
		establishmentIds: string[];
	}
) {
	const target = await db.select().from(users).where(eq(users.id, input.id)).then((r) => r.at(0));
	if (!target) throw new UserError('User not found.');
	const current = await db
		.select()
		.from(orgMemberships)
		.where(eq(orgMemberships.userId, input.id))
		.then((r) => r.at(0));

	// You can rename yourself, but never change your own role or lock yourself out.
	if (input.id === actorId) {
		if (input.status !== 'active') throw new UserError('You cannot disable your own account.');
		if (current && current.role !== input.role) throw new UserError('You cannot change your own role.');
	}

	const targetIsActiveMainHr = current?.role === 'main_hr' && target.status === 'active';
	const staysActiveMainHr = input.role === 'main_hr' && input.status === 'active';
	if (
		removesLastMainHr({
			targetIsActiveMainHr,
			staysActiveMainHr,
			otherActiveMainHrCount: await otherActiveMainHrCount(input.id)
		})
	) {
		throw new UserError('There must always be at least one active Main HR account.');
	}

	await assertEstablishmentsExist(input.establishmentIds);
	const org = await getOrganization();
	await db.transaction(async (tx) => {
		await tx
			.update(users)
			.set({ name: input.name, status: input.status, updatedAt: new Date() })
			.where(eq(users.id, input.id));
		await writeAccess(tx, input.id, org.id, input.role, input.establishmentIds);
		// A disabled account is signed out everywhere immediately.
		if (input.status === 'disabled') await tx.delete(sessions).where(eq(sessions.userId, input.id));
	});
	return { ...target, name: input.name, status: input.status };
}

export async function resetPassword(id: string, password: string) {
	const passwordHash = await hashPassword(password);
	const [row] = await db
		.update(users)
		.set({ passwordHash, updatedAt: new Date() })
		.where(eq(users.id, id))
		.returning({ id: users.id, email: users.email });
	if (!row) throw new UserError('User not found.');
	await db.delete(sessions).where(eq(sessions.userId, id)); // sign them out everywhere
	return row;
}

/** Self-service: proves the current password, sets a new one, keeps this session, drops the rest. */
export async function changeOwnPassword(
	userId: string,
	currentSessionId: string,
	current: string,
	next: string
) {
	const user = await db.select().from(users).where(eq(users.id, userId)).then((r) => r.at(0));
	if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, current))) {
		throw new UserError('Your current password is not correct.');
	}
	const passwordHash = await hashPassword(next);
	await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
	await db
		.delete(sessions)
		.where(and(eq(sessions.userId, userId), ne(sessions.id, currentSessionId)));
}
