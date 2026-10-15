import { goto, invalidate } from '$app/navigation';
import { playTone, readSoundPref, unlockOnFirstTouch, writeSoundPref } from '$lib/staff-sound';

/**
 * The staff app's live line to Customer Support, one per open staff tab. The management layout creates it
 * for anyone who may read Support and shares it by context, so a new guest chat is noticed on every page
 * (sound, tab-title count, optional desktop notification, sidebar badge), not only inside the inbox.
 *
 * It owns the single EventSource to `support/stream`. Presence is that connection: while it is open the
 * server keeps this agent's heartbeat fresh (see the stream route), so there is no heartbeat timer here.
 */

export interface SupportChange {
	kind: string;
	conversationId: string | null;
	assignedUserId: string | null;
	userId: string | null;
}

const SOUND_KEY = 'mm:support-sound';
/** "Typing…" lapses this long after the last signal. */
const TYPING_MS = 4500;

export class SupportLive {
	/** The stream is open. */
	connected = $state(false);
	/** This agent's availability as the server last reported it; null until the first report. */
	available = $state<boolean | null>(null);
	soundOn = $state(true);
	notifications = $state<NotificationPermission | 'unsupported'>('default');
	/** Alerts that arrived while this tab was in the background: shown as "(n)" in the tab title. */
	unseen = $state(0);
	#typing = $state<Record<string, number>>({});

	#base: () => string;
	#userId: () => string;
	#es: EventSource | null = null;
	#listeners = new Set<(e: SupportChange) => void>();
	#typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

	/** Getters, not values: the layout's data (slug, signed-in user) is reactive. */
	constructor(args: { base: () => string; userId: () => string }) {
		this.#base = args.base;
		this.#userId = args.userId;
	}

	/** Opens the stream; returns the cleanup. Call from a layout $effect. */
	start(): () => void {
		this.soundOn = readSoundPref(SOUND_KEY);
		this.notifications = 'Notification' in window ? Notification.permission : 'unsupported';
		const stopUnlock = unlockOnFirstTouch();
		let retry: ReturnType<typeof setTimeout> | undefined;

		const open = () => {
			const es = new EventSource(`${this.#base()}/support/stream`);
			this.#es = es;
			es.addEventListener('ready', (e) => {
				this.connected = true;
				this.available = (JSON.parse((e as MessageEvent).data) as { available: boolean }).available;
				// Events may have been missed while it was down: refresh whatever shows counts.
				void invalidate('app:staff-badges');
				this.#emit({ kind: 'resync', conversationId: null, assignedUserId: null, userId: null });
			});
			es.addEventListener('presence', (e) => {
				this.available = (JSON.parse((e as MessageEvent).data) as { available: boolean }).available;
			});
			es.addEventListener('typing', (e) => {
				const { conversationId } = JSON.parse((e as MessageEvent).data) as { conversationId: string | null };
				if (conversationId) this.#markTyping(conversationId);
			});
			es.addEventListener('change', (e) => this.#onChange(JSON.parse((e as MessageEvent).data) as SupportChange));
			es.onerror = () => {
				this.connected = false;
				// The browser retries by itself, but an error response closes the stream for good: take over.
				if (es.readyState === EventSource.CLOSED) {
					this.#es = null;
					retry = setTimeout(open, 3000);
				}
			};
		};
		open();

		const onVisible = () => {
			if (!document.hidden) this.#clearUnseen();
		};
		document.addEventListener('visibilitychange', onVisible);

		return () => {
			clearTimeout(retry);
			this.#es?.close();
			this.#es = null;
			this.connected = false;
			stopUnlock();
			document.removeEventListener('visibilitychange', onVisible);
			for (const t of this.#typingTimers.values()) clearTimeout(t);
			this.#typingTimers.clear();
			this.#clearUnseen();
		};
	}

	/** Runs `fn` for every change (new chat, message, status, read…); returns the unsubscribe. */
	onChange(fn: (e: SupportChange) => void): () => void {
		this.#listeners.add(fn);
		return () => this.#listeners.delete(fn);
	}

	isTyping(conversationId: string | null | undefined): boolean {
		return !!conversationId && (this.#typing[conversationId] ?? 0) > Date.now();
	}

	toggleSound() {
		this.soundOn = !this.soundOn;
		writeSoundPref(SOUND_KEY, this.soundOn);
		if (this.soundOn) playTone('ticket', 1);
	}

	/** Must be called from a click: browsers only grant notification permission to a user gesture. */
	async enableNotifications() {
		if (!('Notification' in window)) return;
		this.notifications = await Notification.requestPermission();
	}

	#emit(e: SupportChange) {
		for (const fn of this.#listeners) fn(e);
	}

	#markTyping(conversationId: string) {
		this.#typing = { ...this.#typing, [conversationId]: Date.now() + TYPING_MS };
		clearTimeout(this.#typingTimers.get(conversationId));
		this.#typingTimers.set(
			conversationId,
			setTimeout(() => {
				const { [conversationId]: _gone, ...rest } = this.#typing;
				this.#typing = rest;
			}, TYPING_MS + 50)
		);
	}

	#onChange(e: SupportChange) {
		void invalidate('app:staff-badges');
		if (e.kind === 'guest_message' && e.conversationId && this.#typing[e.conversationId]) {
			const { [e.conversationId]: _sent, ...rest } = this.#typing;
			this.#typing = rest;
		}
		this.#emit(e);

		// Only what is this agent's business: a chat assigned to them, or one waiting while they are on duty.
		const mine = e.assignedUserId === this.#userId() || (e.assignedUserId === null && this.available === true);
		if ((e.kind === 'new_conversation' || e.kind === 'guest_message') && mine) this.#alert(e);
	}

	#alert(e: SupportChange) {
		if (this.soundOn) playTone('ticket', 2);
		if (!document.hidden) return;
		this.unseen++;
		this.#applyTitle();
		if (this.notifications !== 'granted') return;
		try {
			const n = new Notification(e.kind === 'new_conversation' ? 'New guest chat' : 'New message from a guest', {
				body: 'Open the Support inbox to reply.',
				tag: 'support-chat'
			});
			n.onclick = () => {
				window.focus();
				void goto(`${this.#base()}/support${e.conversationId ? `?c=${e.conversationId}` : ''}`);
				n.close();
			};
		} catch {
			/* some browsers only allow notifications from a service worker */
		}
	}

	#clearUnseen() {
		this.unseen = 0;
		this.#applyTitle();
	}

	#applyTitle() {
		const bare = document.title.replace(/^\(\d+\)\s+/, '');
		document.title = this.unseen > 0 ? `(${this.unseen}) ${bare}` : bare;
	}
}
