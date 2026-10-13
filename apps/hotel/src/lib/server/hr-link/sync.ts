import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '../db/index';
import { hrConnections, invites, memberships, roles, users } from '../db/schema/index';
import { writeAudit } from '../audit';
import { HrLinkError, fetchPeople, type HrPerson } from './client';

export type LinkFate = 'keep' | 'remove' | 'unknown';

/**
 * Pure: what HR's answer means for a linked login. Only a clear "separated" or "no longer assigned
 * here" removes access. A person HR doesn't recognise at all is left alone and reported — a wrong
 * reference or a reset HR database must never lock staff out.
 */
export function fateOf(person: Pick<HrPerson, 'status' | 'assigned'> | undefined): LinkFate {
	if (!person) return 'unknown';
	if (person.status === 'separated') return 'remove';
	if (!person.assigned) return 'remove';
	return 'keep';
}

export interface SyncResult {
	checked: number;
	removed: Array<{ email: string; reason: string }>;
	/** Would have been removed, but is a hotel admin — flagged for a person to decide. */
	protectedKept: Array<{ email: string; reason: string }>;
	unknown: number;
	/** Set when HR could not be reached; in that case nobody's access was touched. */
	error: string | null;
	connected: boolean;
}

/**
 * Brings this hotel's linked logins in line with HR: someone separated, or moved away from this
 * hotel, loses their membership here. Never throws for an HR outage — it reports and leaves access
 * exactly as it was.
 */
export async function syncHrLinkedMembers(hotelId: string): Promise<SyncResult> {
	const result: SyncResult = { checked: 0, removed: [], protectedKept: [], unknown: 0, error: null, connected: true };

	const linked = await db
		.select({
			userId: memberships.userId,
			personRef: memberships.personRef,
			email: users.email,
			isProtected: roles.isProtected
		})
		.from(memberships)
		.innerJoin(users, eq(users.id, memberships.userId))
		.innerJoin(roles, eq(roles.id, memberships.roleId))
		.where(and(eq(memberships.hotelId, hotelId), isNotNull(memberships.personRef)));
	result.checked = linked.length;

	const pendingLinked = await db
		.select({ id: invites.id, personRef: invites.personRef })
		.from(invites)
		.where(and(eq(invites.hotelId, hotelId), eq(invites.status, 'pending'), isNotNull(invites.personRef)));

	const refs = [...new Set([...linked.map((l) => l.personRef!), ...pendingLinked.map((p) => p.personRef!)])];
	if (refs.length === 0) {
		const conn = await db.select({ h: hrConnections.hotelId }).from(hrConnections).where(eq(hrConnections.hotelId, hotelId));
		result.connected = conn.length > 0;
		return result;
	}

	let people: HrPerson[];
	try {
		people = await fetchPeople(hotelId, refs);
	} catch (e) {
		if (e instanceof HrLinkError) {
			result.error = e.message;
			result.connected = e.kind !== 'not_connected';
			return result;
		}
		throw e;
	}
	const byRef = new Map(people.map((p) => [p.person_ref, p]));
	const reasonOf = (p: HrPerson | undefined) =>
		p?.status === 'separated' ? 'separated in HR' : 'no longer assigned to this hotel in HR';

	for (const m of linked) {
		const person = byRef.get(m.personRef!);
		const fate = fateOf(person);
		if (fate === 'unknown') {
			result.unknown += 1;
			continue;
		}
		if (fate === 'keep') continue;
		const reason = reasonOf(person);
		if (m.isProtected) {
			result.protectedKept.push({ email: m.email, reason });
			continue;
		}
		await db
			.delete(memberships)
			.where(and(eq(memberships.hotelId, hotelId), eq(memberships.userId, m.userId)));
		await writeAudit({
			hotelId,
			action: 'team.hr_access_removed',
			entityType: 'membership',
			entityId: m.userId,
			after: { email: m.email, personRef: m.personRef, reason }
		});
		result.removed.push({ email: m.email, reason });
	}

	// An invite for someone HR no longer has here must not be usable either.
	for (const inv of pendingLinked) {
		if (fateOf(byRef.get(inv.personRef!)) === 'remove') {
			await db.update(invites).set({ status: 'revoked' }).where(eq(invites.id, inv.id));
		}
	}
	return result;
}
