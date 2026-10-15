import { createHash, randomBytes } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import {
	orders,
	supportAgentPresence,
	supportConversations,
	supportFaqs,
	supportMessages,
	users,
	type SupportConversationRow,
	type SupportMessageDirection
} from '$lib/server/db/schema/index';
import { writeAudit } from '$lib/server/audit';
import type { SessionUser } from '$lib/server/auth/session';
import { notifySupport } from '$lib/server/support-realtime';
import { sendSupportReply } from '$lib/server/email/send-support-reply';

/**
 * Customer Support live chat: the guest widget talking to an available staff member.
 * See `schema/support-chat.ts` for the model. Every write runs in one transaction with its audit
 * row and its NOTIFY (delivered only on commit), so the SSE streams never announce a change
 * that rolled back.
 */

export const SUPPORT_MAX_BODY = 1000;
/** An agent counts as online only while their inbox tab keeps sending heartbeats. */
const AGENT_FRESH_SECONDS = 30;
/** How long a closed inbox tab can be reopened and quietly resume being available. */
const RESUME_GRACE_MINUTES = 5;
/** An open chat whose agent has been silent this long goes back to the queue. */
const REQUEUE_AFTER_SECONDS = 120;
/** A queued/open chat nobody has written in for this long is closed. */
const IDLE_CLOSE_MINUTES = 120;
const GUEST_MESSAGES_PER_HOUR = 40;
const STARTS_PER_HOUR = 5;

export class SupportError extends Error {
	constructor(
		message: string,
		readonly code: 'invalid' | 'not_found' | 'closed' | 'rate_limited' | 'offline' = 'invalid'
	) {
		super(message);
	}
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Actor = SessionUser;

const c = supportConversations;
const m = supportMessages;
const p = supportAgentPresence;

export const hashVisitorToken = (token: string) =>
	createHash('sha256').update(token).digest('hex');
export const newVisitorToken = () => randomBytes(24).toString('base64url');
const refOf = (conversationId: string) => `SC-${conversationId.slice(0, 8).toUpperCase()}`;

const freshAgentWhere = (hotelId: string) =>
	and(
		eq(p.hotelId, hotelId),
		eq(p.available, true),
		sql`${p.lastHeartbeatAt} > now() - ${sql.raw(`interval '${AGENT_FRESH_SECONDS} seconds'`)}`
	);

function cleanBody(body: string): string {
	const text = body.trim();
	if (!text) throw new SupportError('Type a message first.');
	if (text.length > SUPPORT_MAX_BODY)
		throw new SupportError(`Please keep messages under ${SUPPORT_MAX_BODY.toLocaleString()} characters.`);
	return text;
}

/** Inserts a message and bumps the conversation's activity time, inside the caller's tx. */
async function addMessage(
	tx: Tx,
	args: {
		hotelId: string;
		conversationId: string;
		direction: SupportMessageDirection;
		body: string;
		authorUserId?: string | null;
	}
) {
	const [row] = await tx
		.insert(m)
		.values({
			hotelId: args.hotelId,
			conversationId: args.conversationId,
			direction: args.direction,
			body: args.body,
			authorUserId: args.authorUserId ?? null
		})
		.returning();
	await tx
		.update(c)
		.set({ lastMessageAt: new Date(), updatedAt: new Date() })
		.where(eq(c.id, args.conversationId));
	return row!;
}

// ---------------------------------------------------------------------------
// Availability & routing
// ---------------------------------------------------------------------------

export async function getSupportAvailability(hotelId: string) {
	const [{ n: agentsOnline } = { n: 0 }] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(p)
		.where(freshAgentWhere(hotelId));
	const [{ n: queued } = { n: 0 }] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(c)
		.where(and(eq(c.hotelId, hotelId), eq(c.status, 'queued')));
	return { available: agentsOnline > 0, agentsOnline, queued };
}

/** The online agent with the fewest open chats who still has room, or null. */
async function pickAgent(tx: Tx, hotelId: string) {
	const openCount = sql<number>`(select count(*)::int from support_conversations sc where sc.hotel_id = ${p.hotelId} and sc.assigned_user_id = ${p.userId} and sc.status = 'open')`;
	const rows = await tx
		.select({ userId: p.userId, name: users.name, max: p.maxConcurrent, open: openCount })
		.from(p)
		.innerJoin(users, eq(users.id, p.userId))
		.where(freshAgentWhere(hotelId))
		.orderBy(asc(openCount), asc(p.lastHeartbeatAt));
	return rows.find((r) => r.open < r.max) ?? null;
}

/** Hands queued chats (oldest first) to agents with room. Safe to call from anywhere. */
export async function drainSupportQueue(hotelId: string): Promise<number> {
	let assigned = 0;
	for (let i = 0; i < 50; i++) {
		const done = await db.transaction(async (tx) => {
			const agent = await pickAgent(tx, hotelId);
			if (!agent) return true;
			const [next] = await tx
				.select({ id: c.id })
				.from(c)
				.where(and(eq(c.hotelId, hotelId), eq(c.status, 'queued')))
				.orderBy(asc(c.createdAt))
				.limit(1);
			if (!next) return true;
			const claimed = await tx
				.update(c)
				.set({ status: 'open', assignedUserId: agent.userId, updatedAt: new Date() })
				.where(and(eq(c.id, next.id), eq(c.status, 'queued')))
				.returning({ id: c.id });
			if (claimed.length === 0) return false; // someone else took it; look again
			await addMessage(tx, {
				hotelId,
				conversationId: next.id,
				direction: 'system',
				body: `${agent.name} joined the chat`
			});
			await writeAudit({
				tx,
				hotelId,
				actor: null,
				actorKind: 'system',
				action: 'support_chat.assign',
				entityType: 'support_conversation',
				entityId: next.id,
				refCode: refOf(next.id),
				after: { assignedUserId: agent.userId }
			});
			await notifySupport(tx, { hotelId, conversationId: next.id, kind: 'status' });
			assigned++;
			return false;
		});
		if (done) break;
	}
	return assigned;
}

// ---------------------------------------------------------------------------
// Guest side
// ---------------------------------------------------------------------------

export interface VisitorMessage {
	id: string;
	direction: SupportMessageDirection;
	body: string;
	createdAt: string;
}

export interface VisitorConversation {
	id: string;
	status: SupportConversationRow['status'];
	agentName: string | null;
	messages: VisitorMessage[];
}

/** The visitor's most recent conversation, with its messages (optionally only those after a time). */
export async function getVisitorConversation(
	hotelId: string,
	tokenHash: string,
	opts: { after?: Date } = {}
): Promise<VisitorConversation | null> {
	const [conv] = await db
		.select({ row: c, agentName: users.name })
		.from(c)
		.leftJoin(users, eq(users.id, c.assignedUserId))
		.where(and(eq(c.hotelId, hotelId), eq(c.visitorTokenHash, tokenHash)))
		.orderBy(desc(c.createdAt))
		.limit(1);
	if (!conv) return null;
	const rows = await db
		.select()
		.from(m)
		.where(
			and(
				eq(m.conversationId, conv.row.id),
				opts.after ? gt(m.createdAt, opts.after) : undefined
			)
		)
		.orderBy(asc(m.createdAt))
		.limit(300);
	return {
		id: conv.row.id,
		status: conv.row.status,
		agentName: conv.agentName,
		messages: rows.map((r) => ({
			id: r.id,
			direction: r.direction,
			body: r.body,
			createdAt: r.createdAt.toISOString()
		}))
	};
}

export async function startConversation(args: {
	hotelId: string;
	tokenHash: string;
	name: string;
	email: string | null;
	firstMessage?: string | null;
	order?: { orderId: string; token: string } | null;
}): Promise<{ conversationId: string }> {
	const name = args.name.trim().slice(0, 80);
	if (!name) throw new SupportError('Please tell us your name.');
	const first = args.firstMessage?.trim() ? cleanBody(args.firstMessage) : null;

	return db.transaction(async (tx) => {
		// An unfinished chat is resumed, not duplicated.
		const [existing] = await tx
			.select({ id: c.id })
			.from(c)
			.where(
				and(
					eq(c.hotelId, args.hotelId),
					eq(c.visitorTokenHash, args.tokenHash),
					inArray(c.status, ['queued', 'open'])
				)
			)
			.limit(1);
		if (existing) {
			if (first) {
				await addMessage(tx, {
					hotelId: args.hotelId,
					conversationId: existing.id,
					direction: 'guest',
					body: first
				});
				await notifySupport(tx, {
					hotelId: args.hotelId,
					conversationId: existing.id,
					kind: 'guest_message'
				});
			}
			return { conversationId: existing.id };
		}

		const [{ n: recent } = { n: 0 }] = await tx
			.select({ n: sql<number>`count(*)::int` })
			.from(c)
			.where(
				and(
					eq(c.hotelId, args.hotelId),
					eq(c.visitorTokenHash, args.tokenHash),
					sql`${c.createdAt} > now() - interval '1 hour'`
				)
			);
		if (recent >= STARTS_PER_HOUR)
			throw new SupportError('That is a lot of chats in a short time. Please wait a little.', 'rate_limited');

		const [{ n: online } = { n: 0 }] = await tx
			.select({ n: sql<number>`count(*)::int` })
			.from(p)
			.where(freshAgentWhere(args.hotelId));
		if (online === 0) throw new SupportError('Nobody is online right now.', 'offline');

		let orderId: string | null = null;
		if (args.order) {
			const [o] = await tx
				.select({ id: orders.id })
				.from(orders)
				.where(
					and(
						eq(orders.id, args.order.orderId),
						eq(orders.hotelId, args.hotelId),
						eq(orders.accessToken, args.order.token)
					)
				)
				.limit(1);
			orderId = o?.id ?? null;
		}

		const agent = await pickAgent(tx, args.hotelId);
		const [conv] = await tx
			.insert(c)
			.values({
				hotelId: args.hotelId,
				visitorTokenHash: args.tokenHash,
				guestName: name,
				guestEmail: args.email?.trim().slice(0, 200) || null,
				orderId,
				status: agent ? 'open' : 'queued',
				assignedUserId: agent?.userId ?? null
			})
			.returning();
		await addMessage(tx, {
			hotelId: args.hotelId,
			conversationId: conv!.id,
			direction: 'system',
			body: agent
				? `${agent.name} joined the chat`
				: 'Our team is helping other guests. You are in the queue and someone will be with you shortly.'
		});
		if (first)
			await addMessage(tx, {
				hotelId: args.hotelId,
				conversationId: conv!.id,
				direction: 'guest',
				body: first
			});
		await writeAudit({
			tx,
			hotelId: args.hotelId,
			actor: null,
			actorKind: 'guest',
			action: 'support_chat.start',
			entityType: 'support_conversation',
			entityId: conv!.id,
			refCode: refOf(conv!.id),
			after: { status: conv!.status, orderId, assignedUserId: agent?.userId ?? null }
		});
		await notifySupport(tx, {
			hotelId: args.hotelId,
			conversationId: conv!.id,
			kind: 'new_conversation'
		});
		return { conversationId: conv!.id };
	});
}

/** A message left while nobody was online. Staff answer it by email. */
export async function leaveOfflineMessage(args: {
	hotelId: string;
	tokenHash: string;
	name: string;
	email: string;
	message: string;
}): Promise<{ conversationId: string }> {
	const name = args.name.trim().slice(0, 80);
	if (!name) throw new SupportError('Please tell us your name.');
	const body = cleanBody(args.message);

	return db.transaction(async (tx) => {
		const [{ n: recent } = { n: 0 }] = await tx
			.select({ n: sql<number>`count(*)::int` })
			.from(c)
			.where(
				and(
					eq(c.hotelId, args.hotelId),
					eq(c.visitorTokenHash, args.tokenHash),
					sql`${c.createdAt} > now() - interval '1 hour'`
				)
			);
		if (recent >= STARTS_PER_HOUR)
			throw new SupportError('That is a lot of messages in a short time. Please wait a little.', 'rate_limited');

		const [conv] = await tx
			.insert(c)
			.values({
				hotelId: args.hotelId,
				visitorTokenHash: args.tokenHash,
				guestName: name,
				guestEmail: args.email.trim().slice(0, 200),
				status: 'offline_message'
			})
			.returning();
		await addMessage(tx, {
			hotelId: args.hotelId,
			conversationId: conv!.id,
			direction: 'guest',
			body
		});
		await writeAudit({
			tx,
			hotelId: args.hotelId,
			actor: null,
			actorKind: 'guest',
			action: 'support_chat.offline_message',
			entityType: 'support_conversation',
			entityId: conv!.id,
			refCode: refOf(conv!.id),
			after: { preview: body.slice(0, 200) }
		});
		await notifySupport(tx, {
			hotelId: args.hotelId,
			conversationId: conv!.id,
			kind: 'new_conversation'
		});
		return { conversationId: conv!.id };
	});
}

async function loadGuestConversation(tx: Tx, hotelId: string, tokenHash: string, id: string) {
	const [conv] = await tx
		.select()
		.from(c)
		.where(and(eq(c.id, id), eq(c.hotelId, hotelId), eq(c.visitorTokenHash, tokenHash)))
		.limit(1);
	if (!conv) throw new SupportError('We could not find that chat.', 'not_found');
	return conv;
}

export async function postGuestMessage(args: {
	hotelId: string;
	tokenHash: string;
	conversationId: string;
	body: string;
}): Promise<void> {
	const text = cleanBody(args.body);
	await db.transaction(async (tx) => {
		const conv = await loadGuestConversation(tx, args.hotelId, args.tokenHash, args.conversationId);
		if (conv.status === 'closed' || conv.status === 'offline_message')
			throw new SupportError('This chat has ended. Start a new one to keep talking.', 'closed');
		const [{ n } = { n: 0 }] = await tx
			.select({ n: sql<number>`count(*)::int` })
			.from(m)
			.where(
				and(
					eq(m.conversationId, conv.id),
					eq(m.direction, 'guest'),
					sql`${m.createdAt} > now() - interval '1 hour'`
				)
			);
		if (n >= GUEST_MESSAGES_PER_HOUR)
			throw new SupportError('That is a lot of messages in a short time. Please wait a little.', 'rate_limited');
		await addMessage(tx, {
			hotelId: args.hotelId,
			conversationId: conv.id,
			direction: 'guest',
			body: text
		});
		await writeAudit({
			tx,
			hotelId: args.hotelId,
			actor: null,
			actorKind: 'guest',
			action: 'support_chat.message',
			entityType: 'support_conversation',
			entityId: conv.id,
			refCode: refOf(conv.id),
			after: { direction: 'guest', preview: text.slice(0, 200) }
		});
		await notifySupport(tx, {
			hotelId: args.hotelId,
			conversationId: conv.id,
			kind: 'guest_message'
		});
	});
}

export async function endConversationAsGuest(args: {
	hotelId: string;
	tokenHash: string;
	conversationId: string;
}): Promise<void> {
	await db.transaction(async (tx) => {
		const conv = await loadGuestConversation(tx, args.hotelId, args.tokenHash, args.conversationId);
		if (conv.status === 'closed') return;
		await tx
			.update(c)
			.set({ status: 'closed', closedAt: new Date(), updatedAt: new Date() })
			.where(eq(c.id, conv.id));
		await addMessage(tx, {
			hotelId: args.hotelId,
			conversationId: conv.id,
			direction: 'system',
			body: 'The guest ended the chat'
		});
		await writeAudit({
			tx,
			hotelId: args.hotelId,
			actor: null,
			actorKind: 'guest',
			action: 'support_chat.close',
			entityType: 'support_conversation',
			entityId: conv.id,
			refCode: refOf(conv.id),
			after: { by: 'guest' }
		});
		await notifySupport(tx, { hotelId: args.hotelId, conversationId: conv.id, kind: 'status' });
	});
	await drainSupportQueue(args.hotelId);
}

/** The widget was opened: staff replies up to now count as seen. */
export async function markStaffMessagesRead(hotelId: string, conversationId: string): Promise<void> {
	await db
		.update(m)
		.set({ readAt: new Date() })
		.where(
			and(
				eq(m.hotelId, hotelId),
				eq(m.conversationId, conversationId),
				eq(m.direction, 'staff'),
				sql`${m.readAt} is null`
			)
		);
}

export async function listSupportFaqs(hotelId: string, opts: { includeInactive?: boolean } = {}) {
	return db
		.select()
		.from(supportFaqs)
		.where(
			and(eq(supportFaqs.hotelId, hotelId), opts.includeInactive ? undefined : eq(supportFaqs.isActive, true))
		)
		.orderBy(asc(supportFaqs.sortOrder), asc(supportFaqs.createdAt));
}

// ---------------------------------------------------------------------------
// Staff side
// ---------------------------------------------------------------------------

export type SupportTab = 'queued' | 'mine' | 'all' | 'closed';
export const SUPPORT_TABS: SupportTab[] = ['queued', 'mine', 'all', 'closed'];

export async function listSupportConversations(hotelId: string, userId: string, tab: SupportTab) {
	const where =
		tab === 'queued'
			? and(eq(c.hotelId, hotelId), inArray(c.status, ['queued', 'offline_message']))
			: tab === 'mine'
				? and(eq(c.hotelId, hotelId), eq(c.status, 'open'), eq(c.assignedUserId, userId))
				: tab === 'closed'
					? and(eq(c.hotelId, hotelId), eq(c.status, 'closed'))
					: and(eq(c.hotelId, hotelId), inArray(c.status, ['queued', 'open', 'offline_message']));
	return db
		.select({
			id: c.id,
			status: c.status,
			guestName: c.guestName,
			guestEmail: c.guestEmail,
			assignedUserId: c.assignedUserId,
			assignedName: users.name,
			lastMessageAt: c.lastMessageAt,
			createdAt: c.createdAt,
			orderCode: sql<string | null>`upper(left(${c.orderId}::text, 8))`,
			preview: sql<string | null>`(select mm.body from support_messages mm where mm.conversation_id = ${c.id} and mm.direction <> 'system' order by mm.created_at desc limit 1)`,
			unread: sql<number>`(select count(*)::int from support_messages mm where mm.conversation_id = ${c.id} and mm.direction = 'guest' and mm.read_at is null)`
		})
		.from(c)
		.leftJoin(users, eq(users.id, c.assignedUserId))
		.where(where)
		.orderBy(desc(c.lastMessageAt))
		.limit(100);
}

/** Counts for the sidebar badge and tab labels. `unread` = chats with an unread guest message. */
export async function countSupportAttention(hotelId: string, userId: string) {
	const [row] = await db
		.select({
			queued: sql<number>`count(*) filter (where ${c.status} in ('queued','offline_message'))::int`,
			unreadMine: sql<number>`count(*) filter (where ${c.status} = 'open' and ${c.assignedUserId} = ${userId} and exists (select 1 from support_messages mm where mm.conversation_id = ${c.id} and mm.direction = 'guest' and mm.read_at is null))::int`
		})
		.from(c)
		.where(and(eq(c.hotelId, hotelId), inArray(c.status, ['queued', 'open', 'offline_message'])));
	return { queued: row?.queued ?? 0, unreadMine: row?.unreadMine ?? 0 };
}

export async function getSupportConversation(hotelId: string, id: string) {
	const [conv] = await db
		.select({
			row: c,
			assignedName: users.name,
			order: {
				id: orders.id,
				status: orders.status,
				totalCentavos: orders.totalCentavos
			}
		})
		.from(c)
		.leftJoin(users, eq(users.id, c.assignedUserId))
		.leftJoin(orders, eq(orders.id, c.orderId))
		.where(and(eq(c.id, id), eq(c.hotelId, hotelId)))
		.limit(1);
	if (!conv) return null;
	const messages = await db
		.select({
			id: m.id,
			direction: m.direction,
			body: m.body,
			createdAt: m.createdAt,
			authorName: users.name
		})
		.from(m)
		.leftJoin(users, eq(users.id, m.authorUserId))
		.where(eq(m.conversationId, id))
		.orderBy(asc(m.createdAt))
		.limit(500);
	return {
		...conv.row,
		assignedName: conv.assignedName,
		order: conv.order?.id
			? { code: conv.order.id.slice(0, 8).toUpperCase(), status: conv.order.status, totalCentavos: conv.order.totalCentavos }
			: null,
		messages
	};
}

export async function markSupportThreadRead(hotelId: string, conversationId: string): Promise<void> {
	await db
		.update(m)
		.set({ readAt: new Date() })
		.where(
			and(
				eq(m.hotelId, hotelId),
				eq(m.conversationId, conversationId),
				eq(m.direction, 'guest'),
				sql`${m.readAt} is null`
			)
		);
}

async function loadStaffConversation(tx: Tx, hotelId: string, id: string) {
	const [conv] = await tx
		.select()
		.from(c)
		.where(and(eq(c.id, id), eq(c.hotelId, hotelId)))
		.limit(1);
	if (!conv) throw new SupportError('That chat could not be found.', 'not_found');
	return conv;
}

export async function claimSupportConversation(args: {
	hotelId: string;
	conversationId: string;
	actor: Actor;
}): Promise<void> {
	await db.transaction(async (tx) => {
		const conv = await loadStaffConversation(tx, args.hotelId, args.conversationId);
		if (conv.status === 'closed') throw new SupportError('That chat has ended.', 'closed');
		if (conv.assignedUserId === args.actor.id) return;
		const wasQueued = conv.status === 'queued';
		await tx
			.update(c)
			.set({
				assignedUserId: args.actor.id,
				status: conv.status === 'offline_message' ? 'offline_message' : 'open',
				updatedAt: new Date()
			})
			.where(eq(c.id, conv.id));
		if (conv.status !== 'offline_message')
			await addMessage(tx, {
				hotelId: args.hotelId,
				conversationId: conv.id,
				direction: 'system',
				body: `${args.actor.name} joined the chat`
			});
		await writeAudit({
			tx,
			hotelId: args.hotelId,
			actor: args.actor,
			action: 'support_chat.claim',
			entityType: 'support_conversation',
			entityId: conv.id,
			refCode: refOf(conv.id),
			before: { assignedUserId: conv.assignedUserId, status: conv.status },
			after: { assignedUserId: args.actor.id, fromQueue: wasQueued }
		});
		await notifySupport(tx, { hotelId: args.hotelId, conversationId: conv.id, kind: 'status' });
	});
}

export async function postSupportStaffMessage(args: {
	hotelId: string;
	conversationId: string;
	body: string;
	actor: Actor;
}): Promise<{ byEmail: boolean; emailed: boolean }> {
	const text = cleanBody(args.body);
	let offline: { email: string | null; name: string | null; original: string } | null = null;

	await db.transaction(async (tx) => {
		const conv = await loadStaffConversation(tx, args.hotelId, args.conversationId);
		if (conv.status === 'closed') throw new SupportError('That chat has ended.', 'closed');

		if (conv.status === 'offline_message') {
			if (!conv.guestEmail) throw new SupportError('This guest left no email address to reply to.');
			const [first] = await tx
				.select({ body: m.body })
				.from(m)
				.where(and(eq(m.conversationId, conv.id), eq(m.direction, 'guest')))
				.orderBy(asc(m.createdAt))
				.limit(1);
			offline = { email: conv.guestEmail, name: conv.guestName, original: first?.body ?? '' };
			await addMessage(tx, {
				hotelId: args.hotelId,
				conversationId: conv.id,
				direction: 'staff',
				body: text,
				authorUserId: args.actor.id
			});
			// An emailed answer is the end of an offline message.
			await tx
				.update(c)
				.set({
					status: 'closed',
					closedAt: new Date(),
					closedByUserId: args.actor.id,
					assignedUserId: args.actor.id,
					updatedAt: new Date()
				})
				.where(eq(c.id, conv.id));
		} else {
			if (conv.assignedUserId !== args.actor.id) {
				await tx
					.update(c)
					.set({ assignedUserId: args.actor.id, status: 'open', updatedAt: new Date() })
					.where(eq(c.id, conv.id));
				if (conv.assignedUserId === null)
					await addMessage(tx, {
						hotelId: args.hotelId,
						conversationId: conv.id,
						direction: 'system',
						body: `${args.actor.name} joined the chat`
					});
			}
			await addMessage(tx, {
				hotelId: args.hotelId,
				conversationId: conv.id,
				direction: 'staff',
				body: text,
				authorUserId: args.actor.id
			});
		}

		await writeAudit({
			tx,
			hotelId: args.hotelId,
			actor: args.actor,
			action: 'support_chat.message',
			entityType: 'support_conversation',
			entityId: conv.id,
			refCode: refOf(conv.id),
			after: { direction: 'staff', preview: text.slice(0, 200), byEmail: conv.status === 'offline_message' }
		});
		await notifySupport(tx, {
			hotelId: args.hotelId,
			conversationId: conv.id,
			kind: 'staff_message'
		});
	});

	const sent = offline as { email: string | null; name: string | null; original: string } | null;
	if (sent?.email) {
		const res = await sendSupportReply({
			hotelId: args.hotelId,
			to: sent.email,
			guestName: sent.name ?? 'there',
			originalMessage: sent.original,
			replyBody: text,
			staffName: args.actor.name
		});
		return { byEmail: true, emailed: res.ok };
	}
	return { byEmail: false, emailed: false };
}

export async function closeSupportConversation(args: {
	hotelId: string;
	conversationId: string;
	actor: Actor;
	/** `support:manage` may close another agent's chat. */
	canManage: boolean;
}): Promise<void> {
	await db.transaction(async (tx) => {
		const conv = await loadStaffConversation(tx, args.hotelId, args.conversationId);
		if (conv.status === 'closed') return;
		if (conv.assignedUserId && conv.assignedUserId !== args.actor.id && !args.canManage)
			throw new SupportError('Only the agent on this chat, or a support manager, can close it.');
		await tx
			.update(c)
			.set({
				status: 'closed',
				closedAt: new Date(),
				closedByUserId: args.actor.id,
				updatedAt: new Date()
			})
			.where(eq(c.id, conv.id));
		await addMessage(tx, {
			hotelId: args.hotelId,
			conversationId: conv.id,
			direction: 'system',
			body: 'This chat was closed. Thanks for contacting us.'
		});
		await writeAudit({
			tx,
			hotelId: args.hotelId,
			actor: args.actor,
			action: 'support_chat.close',
			entityType: 'support_conversation',
			entityId: conv.id,
			refCode: refOf(conv.id),
			before: { status: conv.status },
			after: { by: 'staff' }
		});
		await notifySupport(tx, { hotelId: args.hotelId, conversationId: conv.id, kind: 'status' });
	});
	await drainSupportQueue(args.hotelId);
}

// ---------------------------------------------------------------------------
// Agent presence
// ---------------------------------------------------------------------------

export async function getAgentState(hotelId: string, userId: string) {
	const [row] = await db
		.select({
			available: p.available,
			fresh: sql<boolean>`${p.lastHeartbeatAt} > now() - ${sql.raw(`interval '${AGENT_FRESH_SECONDS} seconds'`)}`
		})
		.from(p)
		.where(and(eq(p.hotelId, hotelId), eq(p.userId, userId)))
		.limit(1);
	return { available: Boolean(row?.available && row.fresh) };
}

export async function setAgentAvailability(args: {
	hotelId: string;
	actor: Actor;
	available: boolean;
}): Promise<void> {
	await db.transaction(async (tx) => {
		await tx
			.insert(p)
			.values({
				hotelId: args.hotelId,
				userId: args.actor.id,
				available: args.available,
				lastHeartbeatAt: new Date()
			})
			.onConflictDoUpdate({
				target: [p.hotelId, p.userId],
				set: { available: args.available, lastHeartbeatAt: new Date(), updatedAt: new Date() }
			});
		await writeAudit({
			tx,
			hotelId: args.hotelId,
			actor: args.actor,
			action: 'support_chat.availability',
			entityType: 'support_agent',
			entityId: args.actor.id,
			after: { available: args.available }
		});
		await notifySupport(tx, { hotelId: args.hotelId, conversationId: null, kind: 'presence' });
	});
	if (args.available) await drainSupportQueue(args.hotelId);
}

/**
 * Called every ~15s by an open inbox tab; returns whether the agent now counts as available.
 * A tab that was closed for longer than `RESUME_GRACE_MINUTES` does not silently put the agent
 * back online: the stale heartbeat is left alone and they must switch availability on again.
 */
export async function agentHeartbeat(hotelId: string, userId: string): Promise<{ available: boolean }> {
	await db
		.update(p)
		.set({ lastHeartbeatAt: new Date() })
		.where(
			and(
				eq(p.hotelId, hotelId),
				eq(p.userId, userId),
				sql`${p.lastHeartbeatAt} > now() - ${sql.raw(`interval '${RESUME_GRACE_MINUTES} minutes'`)}`
			)
		);
	return getAgentState(hotelId, userId);
}

// ---------------------------------------------------------------------------
// FAQ management
// ---------------------------------------------------------------------------

export async function saveSupportFaq(args: {
	hotelId: string;
	actor: Actor;
	id?: string | null;
	question: string;
	answer: string;
	sortOrder: number;
	isActive: boolean;
}): Promise<void> {
	const question = args.question.trim().slice(0, 200);
	const answer = args.answer.trim().slice(0, 2000);
	if (!question || !answer) throw new SupportError('A question and an answer are both needed.');
	await db.transaction(async (tx) => {
		let id = args.id ?? null;
		if (id) {
			const res = await tx
				.update(supportFaqs)
				.set({ question, answer, sortOrder: args.sortOrder, isActive: args.isActive, updatedAt: new Date() })
				.where(and(eq(supportFaqs.id, id), eq(supportFaqs.hotelId, args.hotelId)))
				.returning({ id: supportFaqs.id });
			if (res.length === 0) throw new SupportError('That FAQ could not be found.', 'not_found');
		} else {
			const [row] = await tx
				.insert(supportFaqs)
				.values({ hotelId: args.hotelId, question, answer, sortOrder: args.sortOrder, isActive: args.isActive })
				.returning({ id: supportFaqs.id });
			id = row!.id;
		}
		await writeAudit({
			tx,
			hotelId: args.hotelId,
			actor: args.actor,
			action: 'support_chat.faq_save',
			entityType: 'support_faq',
			entityId: id,
			after: { question, isActive: args.isActive }
		});
	});
}

export async function deleteSupportFaq(args: {
	hotelId: string;
	actor: Actor;
	id: string;
}): Promise<void> {
	await db.transaction(async (tx) => {
		const res = await tx
			.delete(supportFaqs)
			.where(and(eq(supportFaqs.id, args.id), eq(supportFaqs.hotelId, args.hotelId)))
			.returning({ question: supportFaqs.question });
		if (res.length === 0) return;
		await writeAudit({
			tx,
			hotelId: args.hotelId,
			actor: args.actor,
			action: 'support_chat.faq_delete',
			entityType: 'support_faq',
			entityId: args.id,
			before: { question: res[0]!.question }
		});
	});
}

// ---------------------------------------------------------------------------
// Background sweep (pg-boss, every minute)
// ---------------------------------------------------------------------------

/** Requeues chats whose agent vanished, closes abandoned ones, then hands out the queue. */
export async function sweepSupportChats(): Promise<{ requeued: number; closed: number; assigned: number }> {
	const requeued = await db.execute<{ id: string; hotel_id: string }>(sql`
		update support_conversations sc
		set status = 'queued', assigned_user_id = null, updated_at = now()
		where sc.status = 'open'
		  and not exists (
			select 1 from support_agent_presence ap
			where ap.hotel_id = sc.hotel_id and ap.user_id = sc.assigned_user_id
			  and ap.last_heartbeat_at > now() - ${sql.raw(`interval '${REQUEUE_AFTER_SECONDS} seconds'`)}
		  )
		returning sc.id, sc.hotel_id`);
	for (const r of requeued) {
		await db.transaction(async (tx) => {
			await addMessage(tx, {
				hotelId: r.hotel_id,
				conversationId: r.id,
				direction: 'system',
				body: 'Reconnecting you to another member of our team'
			});
			await notifySupport(tx, { hotelId: r.hotel_id, conversationId: r.id, kind: 'status' });
		});
	}

	const closedRows = await db.execute<{ id: string; hotel_id: string }>(sql`
		update support_conversations sc
		set status = 'closed', closed_at = now(), updated_at = now()
		where sc.status in ('queued', 'open')
		  and sc.last_message_at < now() - ${sql.raw(`interval '${IDLE_CLOSE_MINUTES} minutes'`)}
		returning sc.id, sc.hotel_id`);
	for (const r of closedRows) {
		await db.transaction(async (tx) => {
			await addMessage(tx, {
				hotelId: r.hotel_id,
				conversationId: r.id,
				direction: 'system',
				body: 'This chat was closed because it was idle.'
			});
			await notifySupport(tx, { hotelId: r.hotel_id, conversationId: r.id, kind: 'status' });
		});
	}

	const hotelIds = await db.execute<{ hotel_id: string }>(
		sql`select distinct hotel_id from support_conversations where status = 'queued'`
	);
	let assigned = 0;
	for (const h of hotelIds) assigned += await drainSupportQueue(h.hotel_id);
	return { requeued: requeued.length, closed: closedRows.length, assigned };
}
