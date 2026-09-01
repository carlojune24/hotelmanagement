import { createHmac, timingSafeEqual } from 'node:crypto';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

// PayMongo signs webhooks as `t=<timestamp>,te=<test sig>,li=<live sig>` over
// the string `${t}.${rawBody}`, HMAC-SHA256 hex-encoded with the endpoint's secret.
// https://developers.paymongo.com/docs/webhooks#section-verifying-the-webhook-signature
function verifySignature(rawBody: string, header: string, secret: string): boolean {
	const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
	const signature = parts.li ?? parts.te;
	if (!parts.t || !signature) return false;

	const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
	const expectedBuf = Buffer.from(expected);
	const actualBuf = Buffer.from(signature);
	if (expectedBuf.length !== actualBuf.length) return false;
	return timingSafeEqual(expectedBuf, actualBuf);
}

export async function POST({ request }) {
	const secret = env.PAYMONGO_WEBHOOK_SECRET;
	if (!secret) throw error(500, 'PAYMONGO_WEBHOOK_SECRET is not set');

	const signatureHeader = request.headers.get('paymongo-signature');
	if (!signatureHeader) throw error(400, 'Missing Paymongo-Signature header');

	const rawBody = await request.text();
	if (!verifySignature(rawBody, signatureHeader, secret)) {
		throw error(400, 'Invalid signature');
	}

	const event = JSON.parse(rawBody);
	const type = event?.data?.attributes?.type as string | undefined;

	switch (type) {
		case 'checkout_session.payment.paid':
			// TODO: wire up once the booking/payment schema lands — mark the
			// matching booking paid using event.data.attributes.data metadata.
			console.log('paymongo webhook: checkout_session.payment.paid', event.data.attributes.data.id);
			break;
		default:
			console.log('paymongo webhook: unhandled event type', type);
	}

	return json({ received: true });
}
