import { encodeBase32LowerCaseNoPadding } from '@oslojs/encoding';
import { eq } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { db } from '$lib/server/db/index';
import { apiKeyHotelScopes, apiKeys } from '$lib/server/db/schema/index';
import { hashOpaqueToken } from '$lib/server/crypto';
import { ApiError } from '$lib/server/api/api-error';

const KEY_PREFIX = 'mmhk_live_';

/** Raw key format: `mmhk_live_<32 base32 chars>`. Only the hash is ever stored. */
export function generateApiKey(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(20));
	return KEY_PREFIX + encodeBase32LowerCaseNoPadding(bytes);
}

export interface CreateApiKeyInput {
	name: string;
	hotelIds: string[];
	createdByUserId: string | null;
	expiresAt?: Date | null;
}

/** Returns the raw key **once** — it's never retrievable again, same UX contract as
 *  a session token. Store only what the caller needs to display (`id`, `keyPrefix`). */
export async function createApiKey(
	input: CreateApiKeyInput
): Promise<{ id: string; rawKey: string; keyPrefix: string }> {
	if (input.hotelIds.length === 0) throw new Error('An API key needs at least one hotel.');
	const rawKey = generateApiKey();
	const keyPrefix = rawKey.slice(0, 10 + KEY_PREFIX.length);

	const id = await db.transaction(async (tx) => {
		const [row] = await tx
			.insert(apiKeys)
			.values({
				name: input.name,
				keyHash: hashOpaqueToken(rawKey),
				keyPrefix,
				createdByUserId: input.createdByUserId,
				expiresAt: input.expiresAt ?? null
			})
			.returning({ id: apiKeys.id });
		await tx.insert(apiKeyHotelScopes).values(input.hotelIds.map((hotelId) => ({ apiKeyId: row!.id, hotelId })));
		return row!.id;
	});

	return { id, rawKey, keyPrefix };
}

export async function revokeApiKey(id: string): Promise<void> {
	await db.update(apiKeys).set({ revokedAt: new Date(), updatedAt: new Date() }).where(eq(apiKeys.id, id));
}

export async function listApiKeysForHotel(hotelId: string) {
	return db
		.select({
			id: apiKeys.id,
			name: apiKeys.name,
			keyPrefix: apiKeys.keyPrefix,
			scopes: apiKeys.scopes,
			lastUsedAt: apiKeys.lastUsedAt,
			expiresAt: apiKeys.expiresAt,
			revokedAt: apiKeys.revokedAt,
			createdAt: apiKeys.createdAt
		})
		.from(apiKeys)
		.innerJoin(apiKeyHotelScopes, eq(apiKeyHotelScopes.apiKeyId, apiKeys.id))
		.where(eq(apiKeyHotelScopes.hotelId, hotelId));
}

export interface ApiKeyAuth {
	apiKeyId: string;
	hotelIds: string[];
	scopes: string[];
}

/** Reads `Authorization: Bearer <key>`, validates it, and returns its granted hotel
 *  scope. Throws `ApiError` (401/403) on any failure — never fails silently.
 *  Best-effort bumps `last_used_at`. */
export async function requireApiKey(event: RequestEvent): Promise<ApiKeyAuth> {
	const authHeader = event.request.headers.get('authorization') ?? '';
	const [scheme, token] = authHeader.split(' ');
	if (scheme?.toLowerCase() !== 'bearer' || !token) {
		throw new ApiError(401, 'Missing or malformed Authorization header. Expected: Bearer <api key>.');
	}

	const keyHash = hashOpaqueToken(token);
	const [key] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).limit(1);
	if (!key) throw new ApiError(401, 'Invalid API key.');
	if (key.revokedAt) throw new ApiError(401, 'This API key has been revoked.');
	if (key.expiresAt && key.expiresAt.getTime() < Date.now()) throw new ApiError(401, 'This API key has expired.');

	const scopes = await db
		.select({ hotelId: apiKeyHotelScopes.hotelId })
		.from(apiKeyHotelScopes)
		.where(eq(apiKeyHotelScopes.apiKeyId, key.id));

	db.update(apiKeys)
		.set({ lastUsedAt: new Date() })
		.where(eq(apiKeys.id, key.id))
		.catch(() => {});

	return { apiKeyId: key.id, hotelIds: scopes.map((s) => s.hotelId), scopes: key.scopes };
}

/** Explicit 403 (not silent filtering) when a request asks for a hotel outside the
 *  key's grant. Returns the (non-empty) intersection when `requested` is empty
 *  (meaning "everything this key can see"). */
export function assertHotelsInScope(requested: string[], granted: string[]): string[] {
	if (requested.length === 0) return granted;
	const outOfScope = requested.filter((id) => !granted.includes(id));
	if (outOfScope.length > 0) {
		throw new ApiError(403, `This API key is not scoped to hotel(s): ${outOfScope.join(', ')}`);
	}
	return requested;
}
