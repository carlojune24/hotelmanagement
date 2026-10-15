import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';

/**
 * Realtime fan-out for Customer Support chat: Postgres LISTEN/NOTIFY -> in-process SSE streams.
 *
 * Writers call `notifySupport(tx, ...)` inside their transaction, so Postgres delivers the NOTIFY
 * only if the transaction commits. One dedicated connection per process LISTENs and hands each
 * payload to the streams subscribed to that hotel / conversation. Payloads carry ids only, never
 * message bodies: a stream re-reads the DB for what it has not yet sent, so a missed NOTIFY costs
 * at most a late update, never a lost message (clients also reconnect and catch up).
 *
 * Like the job runner, the listener lives on `globalThis` so Vite HMR does not leak a connection
 * on every save.
 */

const CHANNEL = 'support_chat';

export type SupportEventKind =
	| 'new_conversation'
	| 'guest_message'
	| 'staff_message'
	| 'status'
	| 'presence'
	/** Someone is typing. Ephemeral: never stored, streams relay it without re-reading the DB. */
	| 'typing'
	/** Messages were marked read ("Seen"). */
	| 'read'
	/** The LISTEN connection (re)connected, so NOTIFYs may have been missed: re-read everything. */
	| 'resync';

export interface SupportEvent {
	hotelId: string;
	conversationId: string | null;
	kind: SupportEventKind;
	/** Who caused a `typing` event. */
	actor?: 'guest' | 'staff';
	/** The agent the conversation is assigned to (null = queued / unassigned), so a staff client can
	    decide whether a new guest message is its business. Ids only, never message bodies. */
	assignedUserId?: string | null;
	/** The staff member who is typing / who read the thread. */
	userId?: string;
}

interface Subscriber {
	hotelId: string;
	/** Null = every conversation in the hotel (the staff inbox). */
	conversationId: string | null;
	push: (event: SupportEvent) => void;
}

interface Hub {
	subscribers: Set<Subscriber>;
	listening: Promise<void> | null;
	/** How many times the LISTEN session has been established; more than one = it reconnected. */
	sessions: number;
}

declare global {
	// eslint-disable-next-line no-var
	var __mmhotelSupportHub: Hub | undefined;
}

const hub: Hub = (globalThis.__mmhotelSupportHub ??= { subscribers: new Set(), listening: null, sessions: 0 });
hub.sessions ??= 0;

function fanOut(event: SupportEvent) {
	for (const s of hub.subscribers) {
		if (event.kind !== 'resync') {
			if (s.hotelId !== event.hotelId) continue;
			if (s.conversationId && s.conversationId !== event.conversationId) continue;
		}
		try {
			s.push(event);
		} catch {
			// A closed stream must never take the others down.
		}
	}
}

function ensureListening(): Promise<void> {
	if (hub.listening) return hub.listening;
	const url = env.DATABASE_URL;
	if (!url) return Promise.reject(new Error('DATABASE_URL is not set'));

	// A single connection, separate from the app pool: LISTEN needs a session that stays open.
	const listener = postgres(url, { max: 1 });
	hub.listening = listener
		.listen(
			CHANNEL,
			(payload) => {
				let event: SupportEvent;
				try {
					event = JSON.parse(payload) as SupportEvent;
				} catch {
					return;
				}
				fanOut(event);
			},
			// Runs on the first LISTEN and again after every automatic reconnect. Anything notified while the
			// connection was down is gone, so tell every open stream to re-read.
			() => {
				hub.sessions++;
				if (hub.sessions > 1) fanOut({ hotelId: '', conversationId: null, kind: 'resync' });
			}
		)
		.then(() => undefined)
		.catch((err) => {
			console.error('[support] LISTEN failed:', err);
			hub.listening = null;
			throw err;
		});
	return hub.listening;
}

/** Subscribes a stream to events; returns the unsubscribe function. */
export async function subscribeSupport(
	filter: { hotelId: string; conversationId: string | null },
	push: (event: SupportEvent) => void
): Promise<() => void> {
	await ensureListening();
	const sub: Subscriber = { ...filter, push };
	hub.subscribers.add(sub);
	return () => {
		hub.subscribers.delete(sub);
	};
}

/** Anything that can run a drizzle query: the shared `db` or a transaction. */
type Executor = { execute: (query: ReturnType<typeof sql>) => PromiseLike<unknown> };

/** Sends a NOTIFY. Inside a transaction it is delivered at commit; on rollback it is dropped. */
export async function notifySupport(executor: Executor, event: SupportEvent): Promise<void> {
	await executor.execute(sql`select pg_notify(${CHANNEL}, ${JSON.stringify(event)})`);
}
