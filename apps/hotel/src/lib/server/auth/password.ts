import { hash, verify } from '@node-rs/argon2';
import { env } from '$env/dynamic/private';

// OWASP-recommended argon2id parameters.
const opts = {
	memoryCost: 19456,
	timeCost: 2,
	outputLen: 32,
	parallelism: 1
} as const;

function pepper(pw: string): string {
	const p = env.AUTH_PEPPER;
	return p ? `${pw}${p}` : pw;
}

export function hashPassword(password: string): Promise<string> {
	return hash(pepper(password), opts);
}

export function verifyPassword(digest: string, password: string): Promise<boolean> {
	return verify(digest, pepper(password), opts);
}
