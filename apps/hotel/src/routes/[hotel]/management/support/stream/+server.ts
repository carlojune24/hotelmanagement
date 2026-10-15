import { requireCap } from '$lib/server/auth/rbac';
import { agentHeartbeat } from '$lib/server/support-chat';
import { subscribeSupport } from '$lib/server/support-realtime';
import { sseResponse } from '$lib/server/sse';
import type { RequestHandler } from './$types';

/** How often the server vouches for an agent whose staff tab is connected. */
const HEARTBEAT_MS = 15_000;

/**
 * The staff app's live line to the Support chat, hotel-wide. One per open staff tab (the management
 * layout opens it for anyone with `support:read`, on every page, not just the inbox).
 *
 * - **Presence is this connection.** While it is open the server itself refreshes the agent's heartbeat
 *   every 15s. Server timers are not throttled the way a background browser tab's are, so an agent who is
 *   "available" stays online while they read other pages or leave the tab in the background, and goes
 *   offline within ~30s of closing it. (A heartbeat older than the resume grace is not revived: after a
 *   long absence the agent switches availability on again on purpose.)
 * - It carries only the event kind and ids, never message text: pages re-load their own data, so the
 *   inbox's authorisation and shaping stay in one place (`+page.server.ts`).
 */
export const GET: RequestHandler = async ({ request, locals }) => {
	requireCap(locals.user, locals.role, 'support:read');
	const hotelId = locals.hotel!.id;
	const userId = locals.user!.id;

	return sseResponse(request, async (send) => {
		const first = await agentHeartbeat(hotelId, userId);
		send('ready', { available: first.available });

		const beat = setInterval(() => {
			agentHeartbeat(hotelId, userId)
				.then((s) => send('presence', { available: s.available }))
				.catch(() => {
					// A hiccup in the database: the next beat tries again.
				});
		}, HEARTBEAT_MS);

		const unsubscribe = await subscribeSupport({ hotelId, conversationId: null }, (event) => {
			if (event.kind === 'typing') {
				// Another agent typing is not this agent's business; a guest typing is.
				if (event.actor === 'guest') send('typing', { conversationId: event.conversationId });
				return;
			}
			send('change', {
				kind: event.kind,
				conversationId: event.conversationId,
				assignedUserId: event.assignedUserId ?? null,
				userId: event.userId ?? null
			});
		});

		return () => {
			clearInterval(beat);
			unsubscribe();
		};
	});
};
