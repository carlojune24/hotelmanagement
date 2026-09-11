import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PayMongoClient } from '@mm/paymongo';

/**
 * Points PayMongo's test-mode webhook at whichever dev tunnel is currently
 * live. Run `pnpm dev:tunnel` / `dev:tunnel:ngrok` first, then this — a fresh
 * quick tunnel gets a new random hostname every run, so the webhook PayMongo
 * has on file goes stale each time unless re-pointed here.
 */

const tunnelUrlFile = join(process.cwd(), '.tunnel-url');
const webhookIdFile = join(process.cwd(), '.paymongo-webhook-id');
const envFile = join(process.cwd(), '.env');
const events = ['checkout_session.payment.paid', 'payment.failed'];

function updateEnvVar(key: string, value: string) {
	if (!existsSync(envFile)) return;
	const contents = readFileSync(envFile, 'utf8');
	const pattern = new RegExp(`^${key}=.*$`, 'm');
	const line = `${key}=${value}`;
	const updated = pattern.test(contents) ? contents.replace(pattern, line) : `${contents.trimEnd()}\n${line}\n`;
	writeFileSync(envFile, updated);
	console.log(`[sync-dev-webhook] set ${key} in ${envFile}`);
}

async function main() {
	if (!existsSync(tunnelUrlFile)) {
		console.error(
			'[sync-dev-webhook] no .tunnel-url found — start `pnpm dev:tunnel` or `pnpm dev:tunnel:ngrok` first.'
		);
		process.exit(1);
	}

	const secretKey = process.env.PAYMONGO_SECRET_KEY;
	if (!secretKey) {
		console.error('[sync-dev-webhook] PAYMONGO_SECRET_KEY is not set in .env');
		process.exit(1);
	}
	if (!secretKey.startsWith('sk_test_')) {
		console.error(
			'[sync-dev-webhook] PAYMONGO_SECRET_KEY is not a test key (sk_test_...) — refusing to touch webhooks with it. This script is dev-only.'
		);
		process.exit(1);
	}

	const tunnelUrl = readFileSync(tunnelUrlFile, 'utf8').trim();
	const webhookUrl = `${tunnelUrl}/api/webhooks/paymongo`;
	const client = new PayMongoClient({ secretKey });

	const trackedId = existsSync(webhookIdFile) ? readFileSync(webhookIdFile, 'utf8').trim() : null;

	if (trackedId) {
		try {
			const updated = await client.updateWebhook(trackedId, { url: webhookUrl, events });
			console.log(`[sync-dev-webhook] updated webhook ${updated.id} -> ${webhookUrl}`);
			return;
		} catch (err) {
			console.warn(
				`[sync-dev-webhook] tracked webhook ${trackedId} no longer valid (${err instanceof Error ? err.message : String(err)}); looking for another`
			);
		}
	}

	const existing = await client.listWebhooks();
	const testWebhook = existing.find(
		(w) => !w.attributes.livemode && w.attributes.url?.endsWith('/api/webhooks/paymongo')
	);

	if (testWebhook) {
		const updated = await client.updateWebhook(testWebhook.id, { url: webhookUrl, events });
		writeFileSync(webhookIdFile, updated.id);
		console.log(`[sync-dev-webhook] adopted + updated existing webhook ${updated.id} -> ${webhookUrl}`);
		return;
	}

	const created = await client.createWebhook({ url: webhookUrl, events });
	writeFileSync(webhookIdFile, created.id);
	console.log(`[sync-dev-webhook] created webhook ${created.id} -> ${webhookUrl}`);
	if (created.attributes.secret_key) {
		updateEnvVar('PAYMONGO_WEBHOOK_SECRET', created.attributes.secret_key);
	}
}

main().catch((err) => {
	console.error('[sync-dev-webhook] failed:', err);
	process.exit(1);
});
