import { sha256 } from '@oslojs/crypto/sha2';
import { encodeHexLowerCase } from '@oslojs/encoding';

/** SHA-256 hex of an opaque bearer token (session token, API key) — the raw value
 *  is never stored, only this hash. Same derivation used for both session ids and
 *  API keys so a leaked DB row never reveals a usable credential. */
export function hashOpaqueToken(token: string): string {
	return encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
}
