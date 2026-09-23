import { verifyPaymongoWebhookSignature } from '@mm/paymongo';
import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { handlePaymongoEvent } from '$lib/server/paymongo/webhook-handler';

/**
 * LEGACY platform-wide webhook, from before each hotel connected its own PayMongo account.
 * Kept only for the switch-over: it works while `PAYMONGO_WEBHOOK_SECRET` is still in `.env`,
 * so payments already in flight on the old webhook still confirm. Once every hotel is
 * connected under Settings → Payments & email (per-hotel `/api/webhooks/paymongo/[hotel]`),
 * remove the env var and this answers 410 Gone.
 */
export async function POST({ request }) {
	const secret = env.PAYMONGO_WEBHOOK_SECRET;
	if (!secret) throw error(410, 'Use the per-hotel webhook: /api/webhooks/paymongo/{hotel}');

	const signatureHeader = request.headers.get('paymongo-signature');
	if (!signatureHeader) throw error(400, 'Missing Paymongo-Signature header');

	const rawBody = await request.text();
	if (!verifyPaymongoWebhookSignature(rawBody, signatureHeader, secret)) {
		throw error(400, 'Invalid signature');
	}

	await handlePaymongoEvent(JSON.parse(rawBody), { hotelId: null });
	return json({ received: true });
}
