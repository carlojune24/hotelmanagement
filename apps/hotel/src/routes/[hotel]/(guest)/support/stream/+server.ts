import { error } from '@sveltejs/kit';
import { getVisitorConversation, hashVisitorToken } from '$lib/server/support-chat';
import { subscribeSupport } from '$lib/server/support-realtime';
import { sseResponse } from '$lib/server/sse';
import type { RequestHandler } from './$types';

/**
 * Live updates for the visitor's own conversation. `?after=<ISO time>` is the newest message the
 * widget already has; on connect (and reconnect) the stream sends everything newer, so a dropped
 * connection loses nothing. The widget de-duplicates by message id.
 */
export const GET: RequestHandler = async ({ request, locals, cookies, url }) => {
	const hotel = locals.hotel!;
	const token = cookies.get(`mm_support_${hotel.slug}`);
	if (!token) error(404, 'No chat.');
	const tokenHash = hashVisitorToken(token);

	const first = await getVisitorConversation(hotel.id, tokenHash, { after: new Date(0) });
	if (!first) return new Response(null, { status: 204 }); // EventSource stops on 204
	const conversationId = first.id;

	const afterParam = Date.parse(url.searchParams.get('after') ?? '');
	let cursor = Number.isNaN(afterParam) ? 0 : afterParam;

	return sseResponse(request, async (send) => {
		let running = false;
		let again = false;
		// The cursor is millisecond-precise but the DB's timestamps are not, so the last message can
		// match "newer than the cursor" again; remember what this stream already sent.
		const sent = new Set<string>();

		// Serialised: a burst of NOTIFYs becomes at most one more read after the current one.
		const push = async () => {
			if (running) {
				again = true;
				return;
			}
			running = true;
			try {
				do {
					again = false;
					const conv = await getVisitorConversation(hotel.id, tokenHash, {
						after: new Date(cursor)
					});
					if (!conv || conv.id !== conversationId) return;
					const newest = conv.messages.at(-1);
					if (newest) cursor = Math.max(cursor, Date.parse(newest.createdAt));
					const fresh = conv.messages.filter((m) => !sent.has(m.id));
					for (const m of fresh) sent.add(m.id);
					send('update', {
						conversationId: conv.id,
						status: conv.status,
						agentName: conv.agentName,
						messages: fresh
					});
				} while (again);
			} finally {
				running = false;
			}
		};

		const unsubscribe = await subscribeSupport({ hotelId: hotel.id, conversationId }, () => {
			void push();
		});
		await push();
		return unsubscribe;
	});
};
