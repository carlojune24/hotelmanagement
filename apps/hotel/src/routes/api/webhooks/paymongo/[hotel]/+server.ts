import { verifyPaymongoWebhookSignature } from '@mm/paymongo';
import { error, json } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { hotels, paymongoSettings } from '$lib/server/db/schema/index';
import { decryptSecret } from '$lib/server/secrets';
import { handlePaymongoEvent } from '$lib/server/paymongo/webhook-handler';

/**
 * One hotel's PayMongo webhook — registered in THAT hotel's PayMongo account by
 * Settings → Payments & email (`lib/server/paymongo/connection.ts`), signed with the webhook
 * secret stored for it. Events are then scoped to the hotel by `handlePaymongoEvent`.
 */
export async function POST({ request, params }) {
	const [row] = await db
		.select({ hotelId: hotels.id, webhookSecretEnc: paymongoSettings.webhookSecretEnc })
		.from(hotels)
		.innerJoin(paymongoSettings, eq(paymongoSettings.hotelId, hotels.id))
		.where(and(eq(hotels.slug, params.hotel), isNull(hotels.deletedAt)))
		.limit(1);
	if (!row?.webhookSecretEnc) throw error(404, 'No PayMongo connection for this hotel');

	const signatureHeader = request.headers.get('paymongo-signature');
	if (!signatureHeader) throw error(400, 'Missing Paymongo-Signature header');

	const rawBody = await request.text();
	if (
		!verifyPaymongoWebhookSignature(rawBody, signatureHeader, decryptSecret(row.webhookSecretEnc))
	) {
		throw error(400, 'Invalid signature');
	}

	await handlePaymongoEvent(JSON.parse(rawBody), { hotelId: row.hotelId });
	return json({ received: true });
}
