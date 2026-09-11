import { PayMongoClient } from '@mm/paymongo';
import { env } from '$env/dynamic/private';

let client: PayMongoClient | undefined;

/** Lazily-built singleton — `$env/dynamic/private` isn't populated until runtime. */
export function getPaymongoClient(): PayMongoClient {
	if (!client) {
		const secretKey = env.PAYMONGO_SECRET_KEY;
		if (!secretKey) throw new Error('PAYMONGO_SECRET_KEY is not set');
		client = new PayMongoClient({ secretKey });
	}
	return client;
}
