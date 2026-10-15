import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { roleCan } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import {
	SUPPORT_TABS,
	SupportError,
	claimSupportConversation,
	closeSupportConversation,
	countSupportAttention,
	getAgentState,
	getSupportConversation,
	listSupportCannedReplies,
	listSupportConversations,
	markSupportThreadRead,
	postSupportStaffMessage,
	setAgentAvailability,
	signalStaffTyping,
	type SupportTab
} from '$lib/server/support-chat';
import type { Actions, PageServerLoad } from './$types';

/** "14:00:00" -> "2:00 PM", for the canned-reply placeholders. */
function clock(t: string): string {
	const [h = '0', mm = '00'] = t.split(':');
	const hour = Number(h);
	return `${hour % 12 === 0 ? 12 : hour % 12}:${mm} ${hour >= 12 ? 'PM' : 'AM'}`;
}

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
		// Reading is NOT done here: a load runs on every live update, so marking messages read in it would
		// rewrite them each time. The page asks for it (`?/read`) once the thread is actually on screen.
		detail = await getSupportConversation(hotelId, selectedId);
	}

	const [conversations, queuedList, mineList, attention, agent, canned] = await Promise.all([
		listSupportConversations(hotelId, user.id, tab),
		listSupportConversations(hotelId, user.id, 'queued'),
		listSupportConversations(hotelId, user.id, 'mine'),
		countSupportAttention(hotelId, user.id),
		getAgentState(hotelId, user.id),
		listSupportCannedReplies(hotelId)
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
		canned: canned.map((r) => ({ id: r.id, title: r.title, body: r.body })),
		cannedContext: {
			agent: user.name,
			hotel: locals.hotel!.name,
			checkin: clock(locals.hotel!.checkInTime),
			checkout: clock(locals.hotel!.checkOutTime)
		},
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
		const available = form.get('available') === '1';
		await setAgentAvailability({ hotelId: locals.hotel!.id, actor: locals.user!, available });
		// The page shows exactly what was saved; it never guesses from the form it sent.
		return { toggled: true, available };
	},

	/** The thread is on screen: the guest's messages up to now are read (the guest sees "Seen"). */
	read: async ({ locals, request }) => {
		requireCap(locals.user, locals.role, 'support:read');
		const parsed = idField.safeParse((await request.formData()).get('conversationId'));
		if (!parsed.success) return fail(400, { error: 'That chat could not be found.' });
		const changed = await markSupportThreadRead(locals.hotel!.id, parsed.data, locals.user!.id);
		return { read: true, changed };
	},

	/** "Is typing…": ephemeral, nothing is stored. */
	typing: async ({ locals, request }) => {
		requireCap(locals.user, locals.role, 'support:read');
		const parsed = idField.safeParse((await request.formData()).get('conversationId'));
		if (!parsed.success) return fail(400, { error: 'That chat could not be found.' });
		await signalStaffTyping({ hotelId: locals.hotel!.id, conversationId: parsed.data, userId: locals.user!.id });
		return { typing: true };
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
