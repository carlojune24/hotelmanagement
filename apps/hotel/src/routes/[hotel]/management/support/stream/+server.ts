import { requireCap } from '$lib/server/auth/rbac';
import { subscribeSupport } from '$lib/server/support-realtime';
import { sseResponse } from '$lib/server/sse';
import type { RequestHandler } from './$types';

/**
 * "Something changed" pings for the staff Support inbox, hotel-wide. Carries only the event kind
 * and the conversation id — the page re-loads its own data (`invalidate('app:support')`), so the
 * inbox's authorisation and shaping stay in one place (`+page.server.ts`).
 */
export const GET: RequestHandler = async ({ request, locals }) => {
	requireCap(locals.user, locals.role, 'support:read');
	const hotelId = locals.hotel!.id;

	return sseResponse(request, async (send) => {
		send('ready', {});
		return subscribeSupport({ hotelId, conversationId: null }, (event) => {
			send('change', { kind: event.kind, conversationId: event.conversationId });
		});
	});
};
