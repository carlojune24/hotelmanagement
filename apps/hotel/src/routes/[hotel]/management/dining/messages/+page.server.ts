import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { roleCan } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import { recordId } from '$lib/rate-validation';
import { OrderError } from '$lib/server/dining-orders';
import { markGuestMessagesRead, postStaffMessage } from '$lib/server/dining-online';
import { getThreadDetail, listMessageThreads } from '$lib/server/dining-messages';
import { parseThreadFilter } from '$lib/dining-messages';
import type { Actions, PageServerLoad } from './$types';

/**
 * The Dining inbox: every guest conversation about an order, with what it is about (online pickup,
 * online delivery, a pre-order for a table reservation, a table QR order). One page, one selected
 * conversation (`?order=`), so a reload or a shared link lands on the same thread.
 */
export const load: PageServerLoad = async ({ locals, url, depends }) => {
	// Refreshed by this page's own poll and by the Dining layout's alert poll.
	depends('app:dining-messages');
	depends('app:dining-orders');
	requireCap(locals.user, locals.role, 'dining:read');
	const hotelId = locals.hotel!.id;

	const selectedId = url.searchParams.get('order');
	let detail: Awaited<ReturnType<typeof getThreadDetail>> = null;
	if (selectedId && /^[0-9a-f-]{36}$/i.test(selectedId)) {
		detail = await getThreadDetail(hotelId, selectedId);
		// Opening the conversation is what reads the guest's messages.
		if (detail) await markGuestMessagesRead(hotelId, selectedId);
	}

	const threads = await listMessageThreads(hotelId);
	const can = (cap: string) =>
		!!locals.user?.isPlatformAdmin || (!!locals.role && roleCan(locals.role.capabilities, cap));

	return {
		threads,
		filter: parseThreadFilter(url.searchParams.get('filter')),
		selectedId: detail ? selectedId : null,
		detail,
		timezone: locals.hotel!.timezone,
		canWrite: can('dining:write'),
		nowIso: new Date().toISOString()
	};
};

export const actions: Actions = {
	reply: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dining:write');
		const parsed = z
			.object({
				orderId: recordId(),
				body: z.string().trim().min(1, 'Type a message first.').max(1000, 'Please keep messages under 1,000 characters.')
			})
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Type a message first.' });
		try {
			await postStaffMessage({
				hotelId: event.locals.hotel!.id,
				orderId: parsed.data.orderId,
				body: parsed.data.body,
				actor: event.locals.user
			});
			return { replied: true };
		} catch (e) {
			if (e instanceof OrderError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
