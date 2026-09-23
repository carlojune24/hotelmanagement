import type { Webhook } from '@mm/paymongo';

/**
 * Which of a PayMongo account's existing webhooks to REUSE (update its URL + events, enable
 * it) instead of registering another one. PayMongo can only disable webhooks, not delete
 * them, so creating a fresh one on every connect/reconnect — e.g. each time a dev tunnel's
 * URL changes — would pile up dead webhooks in the hotel's account. A new webhook is only
 * created when this returns null. Pure, so it's unit-tested.
 *
 * Preference, first match wins:
 *   1. the webhook this hotel already stored (same account — a reconnect);
 *   2. one already at the exact target URL;
 *   3. one of ours for this hotel on any host (`/api/webhooks/paymongo/{slug}`), enabled first;
 *   4. the legacy platform-wide one (`/api/webhooks/paymongo`), enabled first.
 * Webhooks at any other path (another app, or another hotel sharing the account) are never
 * touched.
 */
export function pickReusableWebhook(
	hooks: Webhook[],
	target: { url: string; slug: string; storedId?: string | null }
): Webhook | null {
	const pathOf = (url: string) => {
		try {
			return new URL(url).pathname.replace(/\/+$/, '');
		} catch {
			return '';
		}
	};
	const ourPath = `/api/webhooks/paymongo/${target.slug}`;
	const legacyPath = '/api/webhooks/paymongo';
	const enabledFirst = (list: Webhook[]) => [
		...list.filter((w) => w.attributes.status === 'enabled'),
		...list.filter((w) => w.attributes.status !== 'enabled')
	];

	return (
		(target.storedId ? hooks.find((w) => w.id === target.storedId) : undefined) ??
		hooks.find((w) => w.attributes.url === target.url) ??
		enabledFirst(hooks.filter((w) => pathOf(w.attributes.url) === ourPath))[0] ??
		enabledFirst(hooks.filter((w) => pathOf(w.attributes.url) === legacyPath))[0] ??
		null
	);
}
