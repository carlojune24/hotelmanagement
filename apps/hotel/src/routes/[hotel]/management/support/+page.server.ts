import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { roleCan } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import {
	SUPPORT_TABS,
	SupportError,
	agentHeartbeat,
	claimSupportConversation,
	closeSupportConversation,
	countSupportAttention,
	getAgentState,
	getSupportConversation,
	listSupportConversations,
	markSupportThreadRead,
	postSupportStaffMessage,
	setAgentAvailability,
	type SupportTab
} from '$lib/server/support-chat';
import type { Actions, PageServerLoad } from './$types';

/**
 * The Support inbox: every guest chat and left message, one selected conversation (`?c=`) so a
 * reload or a shared link lands on the same thread. Live changes arrive over SSE
 * (`stream/+server.ts`) and trigger `invalidate('app:support')`.
 */
export const load: PageServerLoad = async ({ locals, url, depends }) => {
	depends('app:support');
	requireCap(locals.user, locals.role, 'support:read');
	const hotelId = locals.hotel!.id;
	const user = locals.user!;

	const tabParam = url.searchParams.get('tab') as SupportTab | null;
	const tab: SupportTab = tabParam && SUPPORT_TABS.includes(tabParam) ? tabParam : 'all';

	const selectedId = url.searchParams.get('c');
	let detail: Awaited<ReturnType<typeof getSupportConversation>> = null;
	if (selectedId && /^[0-9a-f-]{36}$/i.test(selectedId)) {
		detail = await getSupportConversation(hotelId, selectedId);
		// Opening the conversation is what reads the guest's messages.
		if (detail) await markSupportThreadRead(hotelId, selectedId);
	}

	const [conversations, queuedList, mineList, attention, agent] = await Promise.all([
		listSupportConversations(hotelId, user.id, tab),
		listSupportConversations(hotelId, user.id, 'queued'),
		listSupportConversations(hotelId, user.id, 'mine'),
		countSupportAttention(hotelId, user.id),
		getAgentState(hotelId, user.id)
	]);

	const can = (cap: string) =>
		!!user.isPlatformAdmin || (!!locals.role && roleCan(locals.role.capabilities, cap));

	return {
		tab,
		conversations,
		counts: { queued: queuedList.length, mine: mineList.length },
		attention,
		selectedId: detail ? selectedId : null,
		detail,
		agent,
		currentUserId: user.id,
		canManage: can('support:manage'),
		timezone: locals.hotel!.timezone,
		nowIso: new Date().toISOString()
	};
};

const idField = z.string().uuid();

export const actions: Actions = {
	available: async ({ locals, request }) => {
		requireCap(locals.user, locals.role, 'support:read');
		const form = await request.formData();
		await setAgentAvailability({
			hotelId: locals.hotel!.id,
			actor: locals.user!,
			available: form.get('available') === '1'
		});
		return { toggled: true };
	},

	heartbeat: async ({ locals }) => {
		requireCap(locals.user, locals.role, 'support:read');
		const state = await agentHeartbeat(locals.hotel!.id, locals.user!.id);
		return { beat: true, available: state.available };
	},

	claim: async ({ locals, request }) => {
		requireCap(locals.user, locals.role, 'support:read');
		const parsed = idField.safeParse((await request.formData()).get('conversationId'));
		if (!parsed.success) return fail(400, { error: 'That chat could not be found.' });
		try {
			await claimSupportConversation({
				hotelId: locals.hotel!.id,
				conversationId: parsed.data,
				actor: locals.user!
			});
			return { claimed: true };
		} catch (e) {
			if (e instanceof SupportError) return fail(400, { error: e.message });
			throw e;
		}
	},

	reply: async ({ locals, request }) => {
		requireCap(locals.user, locals.role, 'support:read');
		const parsed = z
			.object({
				conversationId: idField,
				body: z
					.string()
					.trim()
					.min(1, 'Type a message first.')
					.max(1000, 'Please keep messages under 1,000 characters.')
			})
			.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Type a message first.' });
		try {
			const res = await postSupportStaffMessage({
				hotelId: locals.hotel!.id,
				conversationId: parsed.data.conversationId,
				body: parsed.data.body,
				actor: locals.user!
			});
			return { replied: true, emailed: res.emailed, byEmail: res.byEmail };
		} catch (e) {
			if (e instanceof SupportError) return fail(400, { error: e.message });
			throw e;
		}
	},

	close: async ({ locals, request }) => {
		requireCap(locals.user, locals.role, 'support:read');
		const parsed = idField.safeParse((await request.formData()).get('conversationId'));
		if (!parsed.success) return fail(400, { error: 'That chat could not be found.' });
		const canManage =
			!!locals.user!.isPlatformAdmin ||
			(!!locals.role && roleCan(locals.role.capabilities, 'support:manage'));
		try {
			await closeSupportConversation({
				hotelId: locals.hotel!.id,
				conversationId: parsed.data,
				actor: locals.user!,
				canManage
			});
			return { closed: true };
		} catch (e) {
			if (e instanceof SupportError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
