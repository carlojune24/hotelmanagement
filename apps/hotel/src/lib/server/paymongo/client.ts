import { PayMongoClient } from '@mm/paymongo';
import { eq } from 'drizzle-orm';
import { db } from '../db/index';
import { paymongoSettings } from '../db/schema/index';
import { decryptSecret } from '../secrets';

/**
 * Each hotel collects into its OWN PayMongo account — the secret key lives encrypted in
 * `paymongo_settings` (Settings → Payments & email), never in `.env`. A hotel with no row
 * has online payment switched off: nothing may fall back to another account's key, or one
 * hotel's guests would pay into someone else's PayMongo balance.
 */
export class PaymentsNotConfiguredError extends Error {
	constructor() {
		super('Online payment is not set up for this hotel.');
	}
}

const clients = new Map<string, PayMongoClient>();

/** The hotel's own PayMongo client. Throws `PaymentsNotConfiguredError` when not connected. */
export async function getPaymongoClient(hotelId: string): Promise<PayMongoClient> {
	const cached = clients.get(hotelId);
	if (cached) return cached;

	const [row] = await db
		.select({ secretKeyEnc: paymongoSettings.secretKeyEnc })
		.from(paymongoSettings)
		.where(eq(paymongoSettings.hotelId, hotelId))
		.limit(1);
	if (!row) throw new PaymentsNotConfiguredError();

	const client = new PayMongoClient({ secretKey: decryptSecret(row.secretKeyEnc) });
	clients.set(hotelId, client);
	return client;
}

/** Whether guests of this hotel can pay online right now. */
export async function isOnlinePaymentEnabled(hotelId: string): Promise<boolean> {
	const [row] = await db
		.select({ hotelId: paymongoSettings.hotelId })
		.from(paymongoSettings)
		.where(eq(paymongoSettings.hotelId, hotelId))
		.limit(1);
	return !!row;
}

/** Call after a hotel's keys change (connect / disconnect) so the next call re-reads them. */
export function forgetPaymongoClient(hotelId: string): void {
	clients.delete(hotelId);
}
