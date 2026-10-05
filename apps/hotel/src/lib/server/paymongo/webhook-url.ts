/** The fixed tail of a hotel's webhook URL; the admin only supplies the public address before it. */
export const WEBHOOK_PATH = '/api/webhooks/paymongo';

export const webhookPathFor = (slug: string) => `${WEBHOOK_PATH}/${slug}`;

/**
 * Turn what the admin pasted (an ngrok address, possibly with a trailing slash or the whole
 * webhook URL) into a bare https origin. Returns an error message instead when PayMongo
 * couldn't reach it.
 */
export function normalizePublicUrl(raw: string): { origin: string } | { error: string } {
	let text = raw.trim();
	if (!text) return { error: 'Paste the public https address (e.g. from ngrok).' };
	if (!/^[a-z][a-z\d+.-]*:\/\//i.test(text)) text = `https://${text}`;
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		return { error: `"${raw.trim()}" is not a valid address.` };
	}
	if (url.protocol !== 'https:') {
		return { error: 'PayMongo only calls https addresses — use the https:// ngrok URL.' };
	}
	if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(url.hostname)) {
		return { error: "PayMongo can't reach localhost — paste your public tunnel address." };
	}
	return { origin: url.origin };
}

/** The public origin a stored webhook URL was built from (prefills the settings field). */
export function originOfWebhookUrl(webhookUrl: string | null): string {
	if (!webhookUrl) return '';
	try {
		return new URL(webhookUrl).origin;
	} catch {
		return '';
	}
}
