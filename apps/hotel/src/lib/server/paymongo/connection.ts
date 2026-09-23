import { PayMongoClient, PayMongoError, type Webhook } from '@mm/paymongo';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '../db/index';
import { hotels, paymongoSettings } from '../db/schema/index';
import { decryptSecret, encryptSecret, maskSecret } from '../secrets';
import { writeAudit } from '../audit';
import { forgetPaymongoClient } from './client';
import { pickReusableWebhook } from './webhook-reuse';
import type { SessionUser } from '../auth/session';

/**
 * Connecting a hotel's own PayMongo account (Settings → Payments & email). The admin pastes
 * only the secret key; this validates it, then registers — or re-points — the webhook in
 * that account at the hotel's own endpoint and keeps the webhook's signing secret itself.
 */

export class PaymongoConnectionError extends Error {}

/** Every event `handlePaymongoEvent` acts on. */
export const PAYMONGO_WEBHOOK_EVENTS = [
	'checkout_session.payment.paid',
	'payment.paid',
	'payment.failed',
	'payment.refunded',
	'payment.refund.updated'
];

function modeOf(secretKey: string): 'test' | 'live' {
	if (/^sk_test_/.test(secretKey)) return 'test';
	if (/^sk_live_/.test(secretKey)) return 'live';
	throw new PaymongoConnectionError(
		'That is not a PayMongo secret key — it starts with sk_test_ or sk_live_ (not the pk_ public key).'
	);
}

/** PayMongo must be able to reach the webhook, so the app's public origin has to be https. */
function webhookUrlFor(slug: string): string {
	const origin = (env.ORIGIN ?? '').replace(/\/$/, '');
	if (!/^https:\/\//.test(origin) || /\/\/(localhost|127\.|0\.0\.0\.0)/.test(origin)) {
		throw new PaymongoConnectionError(
			`PayMongo can't reach this server at "${origin || '(ORIGIN not set)'}". Set ORIGIN to the site's public https address (or a dev tunnel) and try again.`
		);
	}
	return `${origin}/api/webhooks/paymongo/${slug}`;
}

function friendly(e: unknown): Error {
	if (e instanceof PaymongoConnectionError) return e;
	if (e instanceof PayMongoError) {
		if (e.status === 401) {
			return new PaymongoConnectionError(
				'PayMongo rejected that secret key — check it was copied in full.'
			);
		}
		return new PaymongoConnectionError(`PayMongo returned an error (${e.status}). Try again.`);
	}
	return e instanceof Error ? e : new Error(String(e));
}

/**
 * Point one webhook in the account at `url`: update an existing one of ours in place (URL +
 * events, re-enabled) — see `pickReusableWebhook` — and only create a new one when the account
 * has none. PayMongo can't delete webhooks, so this keeps the account from filling up with dead
 * ones every time the site's address changes. An updated webhook keeps its signing secret.
 */
async function ensureWebhook(
	client: PayMongoClient,
	target: { url: string; slug: string; storedId?: string | null }
): Promise<Webhook> {
	const reuse = pickReusableWebhook(await client.listWebhooks(), target);
	if (!reuse) return client.createWebhook({ url: target.url, events: PAYMONGO_WEBHOOK_EVENTS });

	let hook = await client.updateWebhook(reuse.id, {
		url: target.url,
		events: PAYMONGO_WEBHOOK_EVENTS
	});
	if (hook.attributes.status !== 'enabled') hook = await client.enableWebhook(reuse.id);
	// Some responses omit the secret; the single-webhook read carries it.
	if (!hook.attributes.secret_key) hook = await client.retrieveWebhook(reuse.id);
	return hook;
}

async function hotelSlug(hotelId: string): Promise<string> {
	const [h] = await db
		.select({ slug: hotels.slug })
		.from(hotels)
		.where(eq(hotels.id, hotelId))
		.limit(1);
	if (!h) throw new PaymongoConnectionError('Hotel not found.');
	return h.slug;
}

async function saveConnection(
	hotelId: string,
	secretKey: string,
	hook: Webhook,
	actor: SessionUser | null
) {
	const webhookSecret = hook.attributes.secret_key;
	const values = {
		mode: modeOf(secretKey),
		secretKeyEnc: encryptSecret(secretKey),
		secretKeyHint: maskSecret(secretKey),
		webhookId: hook.id,
		webhookUrl: hook.attributes.url,
		webhookSecretEnc: webhookSecret ? encryptSecret(webhookSecret) : null,
		status: webhookSecret ? ('connected' as const) : ('webhook_error' as const),
		lastError: webhookSecret ? null : 'PayMongo did not return the webhook signing secret.',
		connectedAt: new Date(),
		connectedByUserId: actor?.id ?? null,
		updatedAt: new Date()
	};
	await db
		.insert(paymongoSettings)
		.values({ hotelId, ...values })
		.onConflictDoUpdate({ target: paymongoSettings.hotelId, set: values });
	forgetPaymongoClient(hotelId);
	return values;
}

export async function connectPaymongo(
	hotelId: string,
	rawSecretKey: string,
	actor: SessionUser | null
): Promise<{ mode: 'test' | 'live' }> {
	const secretKey = rawSecretKey.trim();
	const mode = modeOf(secretKey);
	const slug = await hotelSlug(hotelId);
	const url = webhookUrlFor(slug);

	const [previous] = await db
		.select()
		.from(paymongoSettings)
		.where(eq(paymongoSettings.hotelId, hotelId))
		.limit(1);

	let hook: Webhook;
	try {
		hook = await ensureWebhook(new PayMongoClient({ secretKey }), {
			url,
			slug,
			storedId: previous?.webhookId
		});
	} catch (e) {
		throw friendly(e);
	}

	// Only reached when the stored webhook isn't in this account any more — i.e. the key was
	// switched to another account or mode (test ↔ live): stop the old one calling us.
	if (previous?.webhookId && previous.webhookId !== hook.id) {
		try {
			const old = new PayMongoClient({ secretKey: decryptSecret(previous.secretKeyEnc) });
			await old.disableWebhook(previous.webhookId);
		} catch (e) {
			console.warn('connectPaymongo: could not disable the previous webhook', hotelId, e);
		}
	}

	const saved = await saveConnection(hotelId, secretKey, hook, actor);
	await writeAudit({
		hotelId,
		actor,
		action: previous ? 'integration.paymongo_reconnected' : 'integration.paymongo_connected',
		entityType: 'hotel',
		entityId: hotelId,
		after: { mode, keyHint: saved.secretKeyHint, webhookUrl: url, status: saved.status }
	});
	return { mode };
}

/** Re-point the webhook at the current ORIGIN (a dev tunnel's URL changes every restart). */
export async function reconnectPaymongo(hotelId: string, actor: SessionUser | null) {
	const [row] = await db
		.select({ secretKeyEnc: paymongoSettings.secretKeyEnc })
		.from(paymongoSettings)
		.where(eq(paymongoSettings.hotelId, hotelId))
		.limit(1);
	if (!row) throw new PaymongoConnectionError('PayMongo is not connected yet.');
	return connectPaymongo(hotelId, decryptSecret(row.secretKeyEnc), actor);
}

/** Turn online payment off for the hotel: disable its webhook and forget the keys. */
export async function disconnectPaymongo(
	hotelId: string,
	actor: SessionUser | null
): Promise<void> {
	const [row] = await db
		.select()
		.from(paymongoSettings)
		.where(eq(paymongoSettings.hotelId, hotelId))
		.limit(1);
	if (!row) return;

	if (row.webhookId) {
		try {
			const client = new PayMongoClient({ secretKey: decryptSecret(row.secretKeyEnc) });
			await client.disableWebhook(row.webhookId);
		} catch (e) {
			console.warn('disconnectPaymongo: could not disable the webhook', hotelId, e);
		}
	}
	await db.delete(paymongoSettings).where(eq(paymongoSettings.hotelId, hotelId));
	forgetPaymongoClient(hotelId);
	await writeAudit({
		hotelId,
		actor,
		action: 'integration.paymongo_disconnected',
		entityType: 'hotel',
		entityId: hotelId,
		before: { mode: row.mode, keyHint: row.secretKeyHint }
	});
}

/** What the settings page may show — hints and status only, never a secret. */
export async function getPaymongoConnection(hotelId: string) {
	const [row] = await db
		.select({
			mode: paymongoSettings.mode,
			secretKeyHint: paymongoSettings.secretKeyHint,
			webhookUrl: paymongoSettings.webhookUrl,
			status: paymongoSettings.status,
			lastError: paymongoSettings.lastError,
			connectedAt: paymongoSettings.connectedAt
		})
		.from(paymongoSettings)
		.where(eq(paymongoSettings.hotelId, hotelId))
		.limit(1);
	return row ?? null;
}
