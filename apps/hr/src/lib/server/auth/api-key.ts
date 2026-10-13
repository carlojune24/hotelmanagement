import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index';
import { apiKeys } from '../db/schema/index';
import { hashOpaqueToken } from '../crypto';

const PREFIX = 'mmhr_live_';

/** Mints a key for one establishment. The raw value is returned once; only its hash is stored. */
export async function issueApiKey(input: {
	establishmentId: string;
	name: string;
	scopes?: string[];
	createdByUserId?: string | null;
	expiresAt?: Date | null;
}) {
	const raw = PREFIX + Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');
	const [row] = await db
		.insert(apiKeys)
		.values({
			establishmentId: input.establishmentId,
			name: input.name,
			keyHash: hashOpaqueToken(raw),
			keyPrefix: raw.slice(0, 14),
			scopes: input.scopes ?? ['employees:read'],
			createdByUserId: input.createdByUserId ?? null,
			expiresAt: input.expiresAt ?? null
		})
		.returning();
	return { raw, key: row! };
}

/** Resolves a bearer key to its establishment and scopes, or null (unknown/revoked/expired). */
export async function verifyApiKey(raw: string) {
	const row = await db
		.select()
		.from(apiKeys)
		.where(and(eq(apiKeys.keyHash, hashOpaqueToken(raw)), isNull(apiKeys.revokedAt)))
		.then((r) => r.at(0));
	if (!row) return null;
	if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
	await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
	return { establishmentId: row.establishmentId, scopes: row.scopes };
}

export async function revokeApiKey(id: string) {
	await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id));
}
