import { env } from '$env/dynamic/private';

const BASE_URL = 'https://api.paymongo.com/v1';

/** Minimal PayMongo REST client. Auth is HTTP Basic with the secret key as username, empty password. */
export async function paymongoRequest<T = unknown>(
	path: string,
	options: { method: 'GET' | 'POST'; body?: unknown } = { method: 'GET' }
): Promise<T> {
	const secretKey = env.PAYMONGO_SECRET_KEY;
	if (!secretKey) throw new Error('PAYMONGO_SECRET_KEY is not set');

	const auth = Buffer.from(`${secretKey}:`).toString('base64');
	const res = await fetch(`${BASE_URL}${path}`, {
		method: options.method,
		headers: {
			Authorization: `Basic ${auth}`,
			'Content-Type': 'application/json',
			Accept: 'application/json'
		},
		body: options.body != null ? JSON.stringify(options.body) : undefined
	});

	const payload = await res.json().catch(() => null);
	if (!res.ok) {
		throw new Error(`PayMongo request failed (${res.status}): ${JSON.stringify(payload)}`);
	}
	return payload as T;
}
