import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PayMongoWebhookEvent } from './types';

/**
 * Verifies a PayMongo webhook delivery's `Paymongo-Signature` header:
 * `t=<timestamp>,te=<test sig>,li=<live sig>`, each an HMAC-SHA256 hex digest
 * of `${t}.${rawBody}` keyed by the endpoint's webhook secret.
 * https://developers.paymongo.com/docs/webhooks#section-verifying-the-webhook-signature
 *
 * PayMongo always sends *both* `te` and `li` keys — whichever mode the event
 * fired in carries the real hash, the other is present but **empty**, not
 * absent. Pick with `||`, not `??`: a nullish-coalesce here silently prefers
 * an empty `li` in test mode and every signature fails verification.
 */
export function verifyPaymongoWebhookSignature(
	rawBody: string,
	signatureHeader: string,
	secret: string
): boolean {
	const parts = Object.fromEntries(
		signatureHeader.split(',').map((p) => p.split('=') as [string, string])
	);
	const signature = parts.li || parts.te;
	if (!parts.t || !signature) return false;

	const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
	const expectedBuf = Buffer.from(expected);
	const actualBuf = Buffer.from(signature);
	if (expectedBuf.length !== actualBuf.length) return false;
	return timingSafeEqual(expectedBuf, actualBuf);
}

/** Convenience parse of a webhook body already verified by the function above. */
export function parsePaymongoWebhookEvent<TResource = unknown>(
	rawBody: string
): PayMongoWebhookEvent<TResource> {
	return JSON.parse(rawBody);
}
