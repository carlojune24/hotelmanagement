import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import {
	SupportError,
	endConversationAsGuest,
	getSupportAvailability,
	getVisitorConversation,
	hashVisitorToken,
	leaveOfflineMessage,
	listSupportFaqs,
	markStaffMessagesRead,
	newVisitorToken,
	postGuestMessage,
	signalGuestTyping,
	startConversation
} from '$lib/server/support-chat';
import { supportMessageByIp, supportStartByIp, supportTypingByVisitor } from '$lib/server/auth/rate-limit';
import type { RequestHandler } from './$types';

/**
 * Customer Support widget API (guest side). Anonymous: the visitor is identified by an httpOnly
 * cookie holding a random token (only its SHA-256 is stored). Deliberately NOT under `/api/**`,
 * so the audit trail records these writes as the guest's, not the system's.
 *
 *   GET  -> widget state: availability, FAQ chips, and this visitor's latest conversation
 *   POST -> one action: start | message | offline | end | read | typing
 */

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
const cookieName = (slug: string) => `mm_support_${slug}`;

const email = z.string().trim().email().max(200);
const uuid = z.string().uuid();

const actionSchema = z.discriminatedUnion('action', [
	z.object({
		action: z.literal('start'),
		name: z.string().trim().min(1).max(80),
		email: email.optional().or(z.literal('')),
		message: z.string().max(2000).optional(),
		orderId: uuid.optional(),
		token: z.string().max(100).optional()
	}),
	z.object({ action: z.literal('message'), conversationId: uuid, body: z.string().max(2000) }),
	z.object({
		action: z.literal('offline'),
		name: z.string().trim().min(1).max(80),
		email,
		message: z.string().min(1).max(2000)
	}),
	z.object({ action: z.literal('end'), conversationId: uuid }),
	z.object({ action: z.literal('read'), conversationId: uuid }),
	z.object({ action: z.literal('typing'), conversationId: uuid })
]);

/** "14:00:00" -> "2:00 PM". */
function clock(t: string): string {
	const [h = '0', mm = '00'] = t.split(':');
	const hour = Number(h);
	return `${hour % 12 === 0 ? 12 : hour % 12}:${mm} ${hour >= 12 ? 'PM' : 'AM'}`;
}

export const GET: RequestHandler = async ({ locals, cookies }) => {
	const hotel = locals.hotel!;
	const token = cookies.get(cookieName(hotel.slug));
	const tokenHash = token ? hashVisitorToken(token) : null;

	const [availability, faqs, conversation] = await Promise.all([
		getSupportAvailability(hotel.id),
		listSupportFaqs(hotel.id),
		tokenHash ? getVisitorConversation(hotel.id, tokenHash) : null
	]);

	// Answers every hotel can give from its own settings, ahead of the ones staff write.
	const builtIn = [
		{
			id: 'builtin-times',
			question: 'What time is check-in and check-out?',
			answer: `Check-in is from ${clock(hotel.checkInTime)} and check-out is by ${clock(hotel.checkOutTime)}.`
		},
		{
			id: 'builtin-booking',
			question: 'How do I book a room?',
			answer:
				'Choose your dates on the booking page, pick a room and rate, enter your details, then pay securely online with GCash, Maya, card or QR Ph. Your confirmation is emailed right away.'
		}
	];

	return json({
		hotelName: hotel.name,
		availability: { available: availability.available, queued: availability.queued },
		faqs: [...builtIn, ...faqs.map((f) => ({ id: f.id, question: f.question, answer: f.answer }))],
		conversation
	});
};

export const POST: RequestHandler = async ({ request, locals, cookies, getClientAddress }) => {
	const hotel = locals.hotel!;
	const parsed = actionSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, 'Please check what you typed and try again.');
	const input = parsed.data;

	const name = cookieName(hotel.slug);
	let token = cookies.get(name);
	const needsIdentity = input.action === 'start' || input.action === 'offline';
	if (!token && !needsIdentity) error(400, 'We could not find that chat.');

	if (needsIdentity) {
		const ip = getClientAddress();
		const key = `${hotel.id}|${ip}`;
		const wait = supportStartByIp.retryAfter(key);
		if (wait > 0) error(429, 'That is a lot of chats in a short time. Please wait a little.');
		supportStartByIp.consume(key);
		if (!token) {
			token = newVisitorToken();
			cookies.set(name, token, {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				maxAge: COOKIE_MAX_AGE
			});
		}
	}
	const tokenHash = hashVisitorToken(token!);

	// "Typing…" pings are frequent and carry nothing: a per-visitor cap that fails quietly.
	if (input.action === 'typing') {
		const key = `${hotel.id}|${tokenHash}`;
		if (supportTypingByVisitor.retryAfter(key) > 0) return json({ ok: true });
		supportTypingByVisitor.consume(key);
	} else if (!needsIdentity) {
		const key = `${hotel.id}|${getClientAddress()}`;
		if (supportMessageByIp.retryAfter(key) > 0) error(429, 'Please slow down a little.');
		supportMessageByIp.consume(key);
	}

	try {
		switch (input.action) {
			case 'start': {
				const res = await startConversation({
					hotelId: hotel.id,
					tokenHash,
					name: input.name,
					email: input.email || null,
					firstMessage: input.message ?? null,
					order: input.orderId && input.token ? { orderId: input.orderId, token: input.token } : null
				});
				return json({ ok: true, ...res });
			}
			case 'offline': {
				const res = await leaveOfflineMessage({
					hotelId: hotel.id,
					tokenHash,
					name: input.name,
					email: input.email,
					message: input.message
				});
				return json({ ok: true, ...res });
			}
			case 'message':
				await postGuestMessage({
					hotelId: hotel.id,
					tokenHash,
					conversationId: input.conversationId,
					body: input.body
				});
				return json({ ok: true });
			case 'end':
				await endConversationAsGuest({
					hotelId: hotel.id,
					tokenHash,
					conversationId: input.conversationId
				});
				return json({ ok: true });
			case 'read': {
				// Only the visitor's own conversation may be marked.
				const conv = await getVisitorConversation(hotel.id, tokenHash);
				if (conv?.id === input.conversationId) await markStaffMessagesRead(hotel.id, conv.id);
				return json({ ok: true });
			}
			case 'typing':
				await signalGuestTyping({ hotelId: hotel.id, tokenHash, conversationId: input.conversationId });
				return json({ ok: true });
		}
	} catch (e) {
		if (e instanceof SupportError) {
			// `offline` lets the widget swap to the leave-a-message form instead of showing an error.
			return json({ ok: false, code: e.code, message: e.message }, { status: e.code === 'rate_limited' ? 429 : 400 });
		}
		throw e;
	}
};
