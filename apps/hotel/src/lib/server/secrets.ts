import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';

/**
 * Encryption at rest for per-hotel integration secrets (PayMongo secret key, webhook secret,
 * SMTP password). AES-256-GCM under one platform master key, `APP_ENCRYPTION_KEY` (32 bytes,
 * base64). Stored form: `v1:<iv>:<tag>:<ciphertext>`, all base64 — the version prefix leaves
 * room to rotate the scheme or key later. A secret is never sent back to the browser: pages
 * show `maskSecret`'s hint instead.
 */

const VERSION = 'v1';

export class SecretsError extends Error {}

/** Decodes and checks a base64 master key — pure, so it's testable without env. */
export function parseMasterKey(raw: string | undefined): Buffer {
	if (!raw) {
		throw new SecretsError(
			'APP_ENCRYPTION_KEY is not set — generate one with ' +
				`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
		);
	}
	const key = Buffer.from(raw, 'base64');
	if (key.length !== 32) throw new SecretsError('APP_ENCRYPTION_KEY must be 32 bytes (base64).');
	return key;
}

export function encryptWithKey(key: Buffer, plain: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

export function decryptWithKey(key: Buffer, stored: string): string {
	const [version, iv, tag, ct] = stored.split(':');
	if (version !== VERSION || !iv || !tag || ct === undefined) {
		throw new SecretsError('Stored secret is not in a recognised format.');
	}
	try {
		const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
		decipher.setAuthTag(Buffer.from(tag, 'base64'));
		return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString(
			'utf8'
		);
	} catch {
		// Wrong master key or tampered ciphertext — GCM's auth tag check fails either way.
		throw new SecretsError('Could not decrypt a stored secret (wrong APP_ENCRYPTION_KEY?).');
	}
}

export function encryptSecret(plain: string): string {
	return encryptWithKey(parseMasterKey(env.APP_ENCRYPTION_KEY), plain);
}

export function decryptSecret(stored: string): string {
	return decryptWithKey(parseMasterKey(env.APP_ENCRYPTION_KEY), stored);
}

/** Enough to recognise a secret, never enough to use it: `sk_live_…a1b2`. */
export function maskSecret(plain: string): string {
	const s = plain.trim();
	if (s.length <= 8) return '••••';
	const prefix = s.match(/^[a-z]+_(?:live|test)_/)?.[0] ?? '';
	return `${prefix}…${s.slice(-4)}`;
}
