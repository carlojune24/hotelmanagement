import { createHash, randomInt } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { recoveryCodes } from '$lib/server/db/schema/index';

/**
 * Recovery codes: single-use codes that stand in for the emailed sign-in code, so a mailbox outage does not
 * lock Main HR out. Eight at a time, shown once, stored only as hashes.
 */

export const RECOVERY_COUNT = 8;
// No I, O, 0 or 1, so a code read off paper cannot be mistaken.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** `ABCD-EFGH`: 8 characters from a 32-letter alphabet. */
export function generateRecoveryCode(): string {
	let raw = '';
	for (let i = 0; i < 8; i++) raw += ALPHABET[randomInt(0, ALPHABET.length)];
	return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/** What someone typed, as the 8 letters it stands for: upper case, no dashes or spaces. */
export function normalizeRecovery(input: string): string {
	return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** True for something that has the shape of a recovery code (not a 6-digit emailed code). */
export function looksLikeRecovery(input: string): boolean {
	return new RegExp(`^[${ALPHABET}]{8}$`).test(normalizeRecovery(input));
}

/** Hash of a code, bound to its owner so one person's code can never open another's account. */
export function hashRecovery(userId: string, code: string): string {
	return createHash('sha256').update(`${userId}:recovery:${normalizeRecovery(code)}`).digest('hex');
}

/** Replaces the user's codes with a new set and returns them in the clear, this one time. */
export async function issueRecoveryCodes(userId: string): Promise<string[]> {
	const codes = new Set<string>();
	while (codes.size < RECOVERY_COUNT) codes.add(generateRecoveryCode());
	const list = [...codes];
	await db.transaction(async (tx) => {
		await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
		await tx.insert(recoveryCodes).values(list.map((c) => ({ userId, codeHash: hashRecovery(userId, c) })));
	});
	return list;
}

/** How many of the user's recovery codes are still unused, and how many they were given. */
export async function recoverySummary(userId: string): Promise<{ unused: number; total: number }> {
	const [row] = await db
		.select({
			total: sql<number>`count(*)::int`,
			unused: sql<number>`count(*) filter (where ${recoveryCodes.usedAt} is null)::int`
		})
		.from(recoveryCodes)
		.where(eq(recoveryCodes.userId, userId));
	return { unused: row?.unused ?? 0, total: row?.total ?? 0 };
}

/** Spends a recovery code if it is the user's and unused. True only for the one request that spends it. */
export async function consumeRecoveryCode(userId: string, typed: string): Promise<boolean> {
	if (!looksLikeRecovery(typed)) return false;
	const spent = await db
		.update(recoveryCodes)
		.set({ usedAt: new Date() })
		.where(
			and(
				eq(recoveryCodes.userId, userId),
				eq(recoveryCodes.codeHash, hashRecovery(userId, typed)),
				isNull(recoveryCodes.usedAt)
			)
		)
		.returning({ id: recoveryCodes.id });
	return spent.length > 0;
}
