import { requireCap } from '$lib/server/auth/rbac';
import { listGuestMessagesForHotel } from '$lib/server/guest-messages';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'booking:read');
	return { messages: await listGuestMessagesForHotel(locals.hotel!.id) };
};
