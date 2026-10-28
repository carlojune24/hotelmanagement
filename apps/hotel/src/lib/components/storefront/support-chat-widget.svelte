<script lang="ts">
	import { guestBase } from '$lib/guest-base';
	import { page } from '$app/state';
	import MessageCircleIcon from '@lucide/svelte/icons/message-circle';
	import XIcon from '@lucide/svelte/icons/x';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import CheckCheckIcon from '@lucide/svelte/icons/check-check';
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	const base = $derived(guestBase(page));

	/**
	 * Customer Support chat, guest side (Woven Ledger world): FAQ quick questions first, then a
	 * live chat on the site itself. With nobody online the chat simply waits in the queue: the guest keeps
	 * talking here, and whoever comes online first picks it up and answers in the same window.
	 * Anonymous: the server keeps the visitor's identity in an httpOnly cookie. Live updates
	 * arrive over SSE while a conversation is active (messages, "typing…", "Seen"); if the stream drops
	 * the widget reconnects itself with backoff, polls meanwhile, and catches up on missed messages.
	 * Every chat has a unique reference (SC-XXXXXXXX), and when it was opened from a booking page the
	 * booking's code too. When a chat ends its messages are deleted, on the server and in this window.
	 */
	let {
		hotelSlug,
		hotelName,
		lift = false
	}: {
		hotelSlug: string;
		hotelName: string;
		/** Sit above a bottom bar (the wizard's Continue button, the invoice pill). */
		lift?: boolean;
	} = $props();

	type Msg = { id: string; direction: 'guest' | 'staff' | 'system'; body: string; createdAt: string };
	type Faq = { id: string; question: string; answer: string };
	type View = 'home' | 'faq' | 'form' | 'chat' | 'sent';
	type Item =
		| { kind: 'day'; key: string; label: string }
		| { kind: 'system'; m: Msg }
		| { kind: 'bubble'; m: Msg; mine: boolean; first: boolean; last: boolean };

	const api = $derived(`/${hotelSlug}/support`);
	const FLAG = $derived(`mm:support:${hotelSlug}`);

	let open = $state(false);
	let view = $state<View>('home');
	let loading = $state(false);
	let available = $state(false);
	let faqs = $state<Faq[]>([]);
	let activeFaq = $state<Faq | null>(null);

	let convId = $state<string | null>(null);
	/** This chat's unique reference and, if opened from a booking page, that booking's code. */
	let ref = $state<string | null>(null);
	let orderCode = $state<string | null>(null);
	let status = $state('');
	let agentName = $state<string | null>(null);
	let messages = $state<Msg[]>([]);
	let unread = $state(0);
	/** Creation time of the newest guest message staff have read ("Seen"). */
	let seenAt = $state<string | null>(null);
	let staffTyping = $state(false);

	let name = $state('');
	let email = $state('');
	let firstMessage = $state('');
	let draft = $state('');
	let busy = $state(false);
	let error = $state('');

	// ---- connection state
	/** The live stream is open right now. */
	let connected = $state(false);
	/** Down for long enough to tell the guest (a blip under 1.5 s stays quiet). */
	let showReconnect = $state(false);
	let newBelow = $state(false);
	let nearBottom = true;

	let es: EventSource | null = null;
	let scroller: HTMLDivElement | undefined = $state();
	let panelEl: HTMLDivElement | undefined = $state();

	const live = $derived(status === 'queued' || status === 'open');
	const offlineMode = $derived(!available);

	// A visitor with an unfinished chat gets it back on any later visit (the cookie identifies them): the flag only
	// saves the server a lookup for people who never chatted.
	function remember(on: boolean) {
		try {
			if (on) localStorage.setItem(FLAG, '1');
			else localStorage.removeItem(FLAG);
		} catch {
			/* storage blocked: the chat just won't resume until the panel is opened */
		}
	}
	function wasActive(): boolean {
		try {
			return localStorage.getItem(FLAG) === '1';
		} catch {
			return false;
		}
	}

	// ---------------------------------------------------------------- messages

	function merge(incoming: Msg[]) {
		const have = new Set(messages.map((m) => m.id));
		const fresh = incoming.filter((m) => !have.has(m.id));
		if (fresh.length === 0) return;
		messages = [...messages, ...fresh].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
		const fromStaff = fresh.filter((m) => m.direction === 'staff').length;
		if (!open) unread += fresh.filter((m) => m.direction !== 'guest').length;
		if (fromStaff > 0) {
			staffTyping = false;
			if (!open || document.hidden) {
				chime();
				flagTitle();
			}
		}
	}

	// ---------------------------------------------------------------- live stream + recovery

	let retryTimer: ReturnType<typeof setTimeout> | undefined;
	let retryDelay = 1000;
	let pollTimer: ReturnType<typeof setInterval> | undefined;
	let reconnectNoticeTimer: ReturnType<typeof setTimeout> | undefined;
	let typingTimer: ReturnType<typeof setTimeout> | undefined;

	function stopPolling() {
		clearInterval(pollTimer);
		pollTimer = undefined;
	}
	function closeStream() {
		es?.close();
		es = null;
		clearTimeout(retryTimer);
		clearTimeout(reconnectNoticeTimer);
		stopPolling();
		connected = false;
		showReconnect = false;
	}

	/** Reconnects with the CURRENT cursor (the browser's own retry would replay from where the stream began). */
	function scheduleReconnect() {
		clearTimeout(retryTimer);
		// Until the stream is back, ask for new messages every 10 s so a long outage never silences the chat.
		pollTimer ??= setInterval(() => void refresh(), 10_000);
		retryTimer = setTimeout(connect, retryDelay);
		retryDelay = Math.min(retryDelay * 2, 30_000);
	}

	function connect() {
		es?.close();
		es = null;
		if (!convId || !live) return;
		const after = messages.at(-1)?.createdAt ?? '';
		const src = new EventSource(`${api}/stream?after=${encodeURIComponent(after)}`);
		es = src;
		src.onopen = () => {
			connected = true;
			showReconnect = false;
			clearTimeout(reconnectNoticeTimer);
			retryDelay = 1000;
			stopPolling();
		};
		src.addEventListener('update', (e) => {
			const u = JSON.parse((e as MessageEvent).data) as {
				conversationId: string;
				status: string;
				agentName: string | null;
				seenAt: string | null;
				messages: Msg[];
			};
			if (u.conversationId !== convId) return;
			status = u.status;
			agentName = u.agentName;
			seenAt = u.seenAt;
			if (u.status === 'queued' || u.status === 'open') {
				merge(u.messages);
			} else {
				// Ended: the server deleted the messages, so this window does not keep them either.
				messages = [];
				staffTyping = false;
				closeStream();
			}
		});
		src.addEventListener('typing', () => {
			staffTyping = true;
			clearTimeout(typingTimer);
			typingTimer = setTimeout(() => (staffTyping = false), 4500);
		});
		src.onerror = () => {
			connected = false;
			clearTimeout(reconnectNoticeTimer);
			reconnectNoticeTimer = setTimeout(() => (showReconnect = true), 1500);
			// Take over from the browser's retry so every reconnect uses the latest cursor, and so a stream the
			// server refused (an error status closes it for good) is revived too.
			src.close();
			if (es === src) es = null;
			if (live) scheduleReconnect();
		};
	}

	type State = {
		availability: { available: boolean };
		faqs: Faq[];
		conversation: {
			id: string;
			ref: string;
			orderCode: string | null;
			unreadFromTeam: number;
			status: string;
			agentName: string | null;
			seenAt: string | null;
			messages: Msg[];
		} | null;
	};

	async function refresh(): Promise<void> {
		loading = true;
		try {
			const res = await fetch(api);
			if (!res.ok) return;
			const s = (await res.json()) as State;
			available = s.availability.available;
			faqs = s.faqs;
			const c = s.conversation;
			if (c && (c.status === 'queued' || c.status === 'open')) {
				const changed = convId !== c.id;
				convId = c.id;
				ref = c.ref;
				orderCode = c.orderCode;
				status = c.status;
				agentName = c.agentName;
				seenAt = c.seenAt;
				if (changed) {
					messages = c.messages;
					// Back on the site with replies waiting: say so on the launcher.
					if (!open) unread = c.unreadFromTeam;
				} else merge(c.messages);
				if (view === 'home' || changed) view = 'chat';
				if (!es) connect();
				remember(true);
			} else if (c && convId === c.id) {
				// our chat ended (by staff or the idle sweep): its messages are gone
				status = c.status;
				messages = [];
				closeStream();
			} else {
				// Nothing live for this visitor any more: stop asking on every page load.
				remember(false);
			}
		} catch {
			/* offline: the launcher still opens, the form will say so on send */
		} finally {
			loading = false;
		}
	}

	async function post(body: Record<string, unknown>) {
		const res = await fetch(api, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		const json = (await res.json().catch(() => null)) as
			| { ok: true; conversationId?: string }
			| { ok: false; code?: string; message?: string }
			| null;
		return { res, json };
	}

	function toggle() {
		open = !open;
	}

	// Opening refreshes availability + FAQs; a conversation from an earlier page resumes.
	$effect(() => {
		if (open) {
			unread = 0;
			clearTitle();
			void refresh();
		}
	});

	// Resume a chat after a full page load without hitting the server for visitors who never chatted.
	$effect(() => {
		if (wasActive()) void refresh();
		return () => {
			closeStream();
			clearTimeout(typingTimer);
		};
	});

	// Back from a sleeping tab, a lost network or a locked phone: catch up, and revive a stream that died meanwhile.
	$effect(() => {
		const wake = () => {
			if (document.visibilityState === 'hidden') return;
			if (convId && live) {
				void refresh();
				if (!es) connect();
			}
			if (open) clearTitle();
		};
		const down = () => {
			connected = false;
		};
		document.addEventListener('visibilitychange', wake);
		window.addEventListener('online', wake);
		window.addEventListener('offline', down);
		return () => {
			document.removeEventListener('visibilitychange', wake);
			window.removeEventListener('online', wake);
			window.removeEventListener('offline', down);
		};
	});

	// While the panel sits on the home view, "online / offline" is kept honest without a reload.
	$effect(() => {
		if (!open || view === 'chat' || view === 'sent') return;
		const t = setInterval(() => void refresh(), 30_000);
		return () => clearInterval(t);
	});

	// Staff replies seen while the chat is on screen count as read (the team then sees "Seen").
	$effect(() => {
		if (open && view === 'chat' && convId && !document.hidden && messages.some((m) => m.direction === 'staff')) {
			void post({ action: 'read', conversationId: convId }).catch(() => {});
		}
	});

	// ---------------------------------------------------------------- scrolling

	function onScroll() {
		if (!scroller) return;
		nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
		if (nearBottom) newBelow = false;
	}
	function toBottom(smooth = false) {
		if (!scroller) return;
		scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
		newBelow = false;
	}
	// Pin to the newest message, unless the guest scrolled up to read: then offer a "New messages" pill.
	$effect(() => {
		const last = messages.at(-1);
		void staffTyping;
		if (!scroller || !last) return;
		if (nearBottom || last.direction === 'guest') toBottom();
		else newBelow = true;
	});
	$effect(() => {
		if (view === 'chat' && scroller) toBottom();
	});

	// Focus moves into the panel when it opens.
	$effect(() => {
		if (open) panelEl?.focus();
	});

	// A phone's full-screen sheet locks the page behind it and follows the on-screen keyboard.
	$effect(() => {
		if (!open || !window.matchMedia('(max-width: 639px)').matches) return;
		const prev = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		const vv = window.visualViewport;
		const fit = () => {
			if (!panelEl || !vv) return;
			panelEl.style.setProperty('--vvh', `${vv.height}px`);
			panelEl.style.setProperty('--vvt', `${vv.offsetTop}px`);
		};
		fit();
		vv?.addEventListener('resize', fit);
		vv?.addEventListener('scroll', fit);
		return () => {
			document.body.style.overflow = prev;
			vv?.removeEventListener('resize', fit);
			vv?.removeEventListener('scroll', fit);
		};
	});

	// ---------------------------------------------------------------- actions

	function chooseFaq(f: Faq) {
		activeFaq = f;
		view = 'faq';
	}

	function chatWithPerson() {
		error = '';
		view = 'form';
	}

	async function submitForm(e: SubmitEvent) {
		e.preventDefault();
		if (busy) return;
		error = '';
		busy = true;
		try {
			const { json } = await post({
				action: 'start',
				name,
				email,
				message: firstMessage,
				// On a booking page the URL already proves which booking this is; staff then see it.
				orderId: page.params.orderId,
				token: page.url.searchParams.get('t') ?? undefined
			});
			if (json?.ok) {
				firstMessage = '';
				messages = [];
				convId = null;
				await refresh();
			} else {
				error = (json && 'message' in json && json.message) || 'We could not start the chat. Please try again.';
			}
		} catch {
			error = 'You seem to be offline. Please check your connection.';
		} finally {
			busy = false;
		}
	}

	async function send(e: SubmitEvent) {
		e.preventDefault();
		const text = draft.trim();
		if (!text || !convId || busy || !live) return;
		busy = true;
		error = '';
		try {
			const { json } = await post({ action: 'message', conversationId: convId, body: text });
			if (json?.ok) {
				draft = '';
				// The stream normally delivers our own message back at once; if it is down, pull it.
				if (!es || !connected) await refresh();
			} else {
				error = (json && 'message' in json && json.message) || 'We could not send that.';
			}
		} catch {
			error = 'You seem to be offline. Your message was not sent. Please check your connection.';
		} finally {
			busy = false;
		}
	}

	// "Typing…" for the team: one signal per 2.5 s while the guest is writing in a live chat with an agent.
	let lastTypingAt = 0;
	function onInput() {
		if (!convId || status !== 'open') return;
		const now = Date.now();
		if (now - lastTypingAt < 2500) return;
		lastTypingAt = now;
		void post({ action: 'typing', conversationId: convId }).catch(() => {});
	}

	async function endChat() {
		if (!convId) return;
		await post({ action: 'end', conversationId: convId }).catch(() => {});
		status = 'closed';
		closeStream();
		remember(false);
		await refresh();
	}

	function startOver() {
		convId = null;
		ref = null;
		orderCode = null;
		status = '';
		messages = [];
		agentName = null;
		seenAt = null;
		staffTyping = false;
		error = '';
		remember(false);
		view = 'home';
		void refresh();
	}

	/** Esc closes; Tab stays inside the panel while it is open. */
	function onKeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') {
			open = false;
			return;
		}
		if (e.key !== 'Tab' || !panelEl || !panelEl.contains(document.activeElement)) return;
		const f = [...panelEl.querySelectorAll<HTMLElement>('button, a[href], input, textarea, [tabindex="0"]')].filter(
			(el) => !el.hasAttribute('disabled')
		);
		if (f.length === 0) return;
		const first = f[0]!;
		const last = f[f.length - 1]!;
		if (e.shiftKey && document.activeElement === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	}

	// ---------------------------------------------------------------- tab title + chime

	function clearTitle() {
		document.title = document.title.replace(/^\(\d+\)\s+/, '');
	}
	function flagTitle() {
		if (document.hidden) document.title = `(${Math.max(1, unread)}) ${document.title.replace(/^\(\d+\)\s+/, '')}`;
	}
	let audio: AudioContext | null = null;
	/** A soft two-note chime for a reply that arrives while the panel is closed or the tab is in the background. */
	function chime() {
		try {
			audio ??= new AudioContext();
			if (audio.state === 'suspended') void audio.resume();
			if (audio.state !== 'running') return;
			[660, 880].forEach((freq, i) => {
				const osc = audio!.createOscillator();
				const gain = audio!.createGain();
				const t = audio!.currentTime + i * 0.14;
				osc.frequency.value = freq;
				gain.gain.setValueAtTime(0.0001, t);
				gain.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
				gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
				osc.connect(gain).connect(audio!.destination);
				osc.start(t);
				osc.stop(t + 0.22);
			});
		} catch {
			/* no audio available: the badge and title still tell them */
		}
	}

	// ---------------------------------------------------------------- display

	const clock = (iso: string) =>
		new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
	const dayKey = (iso: string) => new Date(iso).toDateString();
	function dayLabel(iso: string) {
		const d = new Date(iso);
		const today = new Date();
		const yest = new Date();
		yest.setDate(today.getDate() - 1);
		if (d.toDateString() === today.toDateString()) return 'Today';
		if (d.toDateString() === yest.toDateString()) return 'Yesterday';
		return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' }).format(d);
	}
	const initials = (n: string | null) =>
		(n ?? 'Team')
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((p) => p[0]!.toUpperCase())
			.join('');

	const GROUP_MS = 5 * 60 * 1000;
	/** Messages as chat rows: day separators, system notes, and bubbles grouped by sender within 5 minutes. */
	const items = $derived.by<Item[]>(() => {
		const out: Item[] = [];
		let lastDay = '';
		let prev: Msg | null = null;
		for (let i = 0; i < messages.length; i++) {
			const m = messages[i]!;
			const day = dayKey(m.createdAt);
			if (day !== lastDay) {
				out.push({ kind: 'day', key: day, label: dayLabel(m.createdAt) });
				lastDay = day;
				prev = null;
			}
			if (m.direction === 'system') {
				out.push({ kind: 'system', m });
				prev = null;
				continue;
			}
			const next = messages[i + 1];
			const joinsPrev =
				prev !== null && prev.direction === m.direction && Date.parse(m.createdAt) - Date.parse(prev.createdAt) < GROUP_MS;
			const joinsNext =
				!!next &&
				next.direction === m.direction &&
				dayKey(next.createdAt) === day &&
				Date.parse(next.createdAt) - Date.parse(m.createdAt) < GROUP_MS;
			out.push({ kind: 'bubble', m, mine: m.direction === 'guest', first: !joinsPrev, last: !joinsNext });
			prev = m;
		}
		return out;
	});

	/** The newest guest message the team has read: it gets the "Seen" mark. */
	const seenId = $derived.by(() => {
		if (!seenAt) return null;
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i]!;
			if (m.direction === 'guest' && m.createdAt <= seenAt) return m.id;
		}
		return null;
	});
</script>

<svelte:window onkeydown={onKeydown} />

<div class="support" class:lift class:is-open={open}>
	{#if open}
		<div class="panel" role="dialog" aria-label="Customer Support" tabindex="-1" bind:this={panelEl}>
			<header class="head">
				{#if view !== 'home' && !(view === 'chat' && live)}
					<button type="button" class="icon-btn" onclick={() => (view === 'chat' ? startOver() : (view = 'home'))} aria-label="Back">
						<ChevronLeftIcon class="size-5" aria-hidden="true" />
					</button>
				{/if}
				<div class="head-title">
					<span class="head-name">Customer Support</span>
					<span class="head-sub">
						{#if view === 'chat' && live}
							<span class="head-dot" class:on={status === 'open'} aria-hidden="true"></span>
							{status === 'open' && agentName ? `${agentName} · ${hotelName}` : 'Waiting for a team member'}
						{:else}
							{hotelName}
						{/if}
					</span>
				</div>
				<button type="button" class="icon-btn" onclick={() => (open = false)} aria-label="Close chat">
					<XIcon class="size-5" aria-hidden="true" />
				</button>
			</header>

			<div class="body">
				{#if view === 'home'}
					<div class="scroll">
						<p class="row-hotel">You are inquiring at {hotelName}. What would you like to know?</p>
						{#if loading && faqs.length === 0}
							<p class="muted">Loading…</p>
						{/if}
						<ul class="chips">
							{#each faqs as f (f.id)}
								<li><button type="button" class="chip" onclick={() => chooseFaq(f)}>{f.question}</button></li>
							{/each}
							<li><a class="chip chip-link" href="{base}/dates">Book now</a></li>
						</ul>
					</div>
					<div class="foot">
						<p class="presence">
							<span class="dot" class:on={available} aria-hidden="true"></span>
							{available ? 'Our team is online' : 'Our team is away right now'}
						</p>
						<button type="button" class="primary" onclick={chatWithPerson}>Chat with a person</button>
						{#if !available}
							<p class="hint">Nobody is online right now. You can still start a chat: it waits for you here, and we reply on this page as soon as someone is back.</p>
						{/if}
					</div>
				{:else if view === 'faq' && activeFaq}
					<div class="scroll">
						<p class="row-guest">{activeFaq.question}</p>
						<p class="row-hotel">{activeFaq.answer}</p>
					</div>
					<div class="foot">
						<button type="button" class="ghost" onclick={() => (view = 'home')}>More questions</button>
						<button type="button" class="primary" onclick={chatWithPerson}>Still need help? Chat with a person</button>
					</div>
				{:else if view === 'form'}
					<form class="form scroll" onsubmit={submitForm}>
						<p class="row-hotel">
							{offlineMode
								? 'Nobody is online right now. Tell us what you need: your chat waits here, and a team member will reply in this window as soon as they are back.'
								: 'Tell us who you are and what you need. A team member will join the chat.'}
						</p>
						<label class="field">
							<span class="label">Your name</span>
							<input bind:value={name} required maxlength="80" autocomplete="name" />
						</label>
						<label class="field">
							<span class="label">Email (optional)</span>
							<input type="email" bind:value={email} maxlength="200" autocomplete="email" />
						</label>
						<label class="field">
							<span class="label">{offlineMode ? 'Your message' : 'How can we help? (optional)'}</span>
							<textarea bind:value={firstMessage} rows="3" maxlength="1000" required={offlineMode}></textarea>
						</label>
						{#if error}<p class="error" role="alert">{error}</p>{/if}
						<button type="submit" class="primary" disabled={busy || !name.trim()}>
							{busy ? 'Starting…' : 'Start chat'}
						</button>
					</form>
				{:else if view === 'sent'}
					<div class="scroll">
						<p class="row-hotel">Thank you. Your message is with the team and we will reply to {email || 'your email'} as soon as we can.</p>
					</div>
					<div class="foot">
						<button type="button" class="primary" onclick={startOver}>Done</button>
					</div>
				{:else}
					{#if ref}
						<p class="idstrip">
							<span>Chat ID <b class="ledger-data">{ref}</b></span>
							{#if orderCode}<span>Booking <b class="ledger-data">{orderCode}</b></span>{/if}
						</p>
					{/if}
					{#if live && showReconnect}
						<p class="banner" role="status">Reconnecting… your messages will still send.</p>
					{:else if status === 'queued'}
						<p class="banner" role="status">
							{available
								? 'All our team are busy right now. You are in line and will be answered here.'
								: 'Nobody is online right now. Your messages are saved. Keep this page open or come back later: a team member will reply here.'}
						</p>
					{/if}
					<div class="chat-wrap">
						<div class="scroll chat" bind:this={scroller} onscroll={onScroll} aria-live="polite">
							{#each items as it (it.kind === 'day' ? 'day-' + it.key : it.m.id)}
								{#if it.kind === 'day'}
									<p class="day"><span>{it.label}</span></p>
								{:else if it.kind === 'system'}
									<p class="row-system">{it.m.body}</p>
								{:else}
									<div class="msg" class:mine={it.mine} class:first={it.first} class:last={it.last}>
										{#if !it.mine}
											<span class="avatar" class:hidden-av={!it.last} aria-hidden="true">{initials(agentName)}</span>
										{/if}
										<div class="stack">
											{#if it.first && !it.mine}<span class="who">{agentName ?? 'Team'}</span>{/if}
											<div class="bubble">{it.m.body}</div>
											{#if it.last}
												<span class="meta">
													{clock(it.m.createdAt)}
													{#if it.mine && it.m.id === seenId}
														<span class="seen"><CheckCheckIcon class="size-3.5" aria-hidden="true" /> Seen</span>
													{/if}
												</span>
											{/if}
										</div>
									</div>
								{/if}
							{/each}
							{#if staffTyping}
								<div class="msg first last">
									<span class="avatar" aria-hidden="true">{initials(agentName)}</span>
									<div class="stack">
										<div class="bubble typing" aria-label="{agentName ?? 'The team'} is typing"><i></i><i></i><i></i></div>
									</div>
								</div>
							{/if}
						</div>
						{#if newBelow}
							<button type="button" class="pill" onclick={() => toBottom(true)}>
								<ArrowDownIcon class="size-4" aria-hidden="true" /> New messages
							</button>
						{/if}
					</div>
					{#if live}
						<form class="composer" onsubmit={send}>
							{#if error}<p class="error" role="alert">{error}</p>{/if}
							<div class="composer-row">
								<textarea
									bind:value={draft}
									rows="1"
									maxlength="1000"
									placeholder="Type here and press enter"
									aria-label="Message"
									oninput={onInput}
									onkeydown={(e) => {
										if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
											e.preventDefault();
											e.currentTarget.form?.requestSubmit();
										}
									}}
								></textarea>
								<button type="submit" class="send" disabled={busy || !draft.trim()}>Send</button>
							</div>
							<button type="button" class="ghost end" onclick={endChat} title="Ending the chat deletes its messages">End chat</button>
						</form>
					{:else}
						<div class="foot">
							<p class="presence">This chat has ended. Its messages have been deleted.</p>
							<button type="button" class="primary" onclick={startOver}>Start a new chat</button>
						</div>
					{/if}
				{/if}
			</div>
		</div>
	{/if}

	<button
		type="button"
		class="launcher"
		aria-expanded={open}
		aria-label={open ? 'Close Customer Support' : 'Open Customer Support'}
		onclick={toggle}
	>
		{#if open}
			<XIcon class="size-6" aria-hidden="true" />
		{:else}
			<MessageCircleIcon class="size-6" aria-hidden="true" />
			<span class="launcher-label">Chat with us</span>
			{#if unread > 0}<span class="badge" aria-label="{unread} new messages">{unread}</span>{/if}
		{/if}
	</button>
</div>

<style>
	.support {
		position: fixed;
		right: 1.25rem;
		bottom: calc(1.25rem + var(--sf-bottom-bar, 0px));
		z-index: 45;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.75rem;
		font-family: 'Inter Variable', ui-sans-serif, sans-serif;
		color: var(--ledger-ink);
	}
	.support.lift {
		bottom: calc(5rem + var(--sf-bottom-bar, 0px));
	}
	/* Open: above the sticky booking bar (z 46) and the floating invoice (z 50). */
	.support.is-open {
		z-index: 60;
	}

	/* ---- launcher ---- */
	.launcher {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 3.25rem;
		padding: 0 1.1rem;
		font: inherit;
		font-weight: 600;
		font-size: 0.9375rem;
		color: var(--ledger-paper);
		background: var(--hotel-accent);
		border: 0;
		border-radius: 999px;
		cursor: pointer;
		box-shadow: 0 10px 28px -12px rgb(0 0 0 / 0.5);
	}
	.launcher:hover {
		background: var(--hotel-accent-deep);
	}
	.launcher:focus-visible,
	.chip:focus-visible,
	.primary:focus-visible,
	.icon-btn:focus-visible,
	.send:focus-visible,
	.pill:focus-visible,
	.ghost:focus-visible {
		outline: 2px solid var(--hotel-accent);
		outline-offset: 2px;
	}
	.badge {
		position: absolute;
		top: -0.25rem;
		right: -0.125rem;
		min-width: 1.25rem;
		padding: 0 0.3rem;
		font-family: 'JetBrains Mono Variable', ui-monospace, monospace;
		font-size: 0.6875rem;
		line-height: 1.25rem;
		text-align: center;
		color: var(--ledger-paper);
		background: var(--ledger-danger, #b91c1c);
		border: 2px solid var(--ledger-paper);
		border-radius: 999px;
	}

	/* ---- panel ---- */
	.panel {
		display: flex;
		flex-direction: column;
		width: min(24rem, calc(100vw - 2.5rem));
		height: min(36rem, calc(100dvh - 8.5rem));
		overflow: hidden;
		background: var(--ledger-paper);
		border: 1px solid var(--ledger-rule);
		border-radius: 14px;
		box-shadow: 0 24px 60px -24px rgb(0 0 0 / 0.55);
		outline: none;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 0.75rem 0.75rem 1rem;
		color: var(--ledger-paper);
		background: var(--hotel-accent);
	}
	.head-title {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
	}
	.head-name {
		font-family: var(--ledger-font-display, Georgia, serif);
		font-size: 1.0625rem;
		font-weight: 500;
	}
	.head-sub {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		overflow: hidden;
		font-size: 0.75rem;
		text-overflow: ellipsis;
		white-space: nowrap;
		opacity: 0.92;
	}
	.head-dot {
		width: 0.5rem;
		height: 0.5rem;
		flex-shrink: 0;
		border: 1px solid currentColor;
		border-radius: 999px;
	}
	.head-dot.on {
		background: currentColor;
	}
	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		flex-shrink: 0;
		color: inherit;
		background: transparent;
		border: 0;
		border-radius: 999px;
		cursor: pointer;
	}
	.icon-btn:hover {
		background: color-mix(in oklch, var(--ledger-paper) 18%, transparent);
	}

	.body {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
	}
	.scroll {
		flex: 1;
		min-height: 0;
		padding: 1rem;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.idstrip {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		margin: 0;
		padding: 0.35rem 1rem;
		font-size: 0.6875rem;
		color: var(--ledger-ink-muted);
		background: var(--ledger-paper-2);
		border-bottom: 1px solid var(--ledger-rule);
	}
	.idstrip b {
		font-weight: 600;
		color: var(--ledger-ink);
	}
	.hint {
		margin: 0.625rem 0 0;
		font-size: 0.75rem;
		line-height: 1.45;
		color: var(--ledger-ink-muted);
	}
	.banner {
		margin: 0;
		padding: 0.4rem 1rem;
		font-size: 0.75rem;
		text-align: center;
		color: var(--ledger-ink);
		background: color-mix(in oklch, var(--hotel-accent) 14%, var(--ledger-paper));
		border-bottom: 1px solid var(--ledger-rule);
	}

	/* ---- FAQ / info rows (home, FAQ answer, forms) ---- */
	.row-hotel,
	.row-guest {
		margin: 0;
		padding: 0.75rem 0;
		font-size: 0.9375rem;
		line-height: 1.5;
		white-space: pre-line;
		overflow-wrap: anywhere;
		border-bottom: 1px solid var(--ledger-rule);
	}
	.row-guest {
		text-align: right;
	}
	.muted {
		font-size: 0.875rem;
		color: var(--ledger-ink-muted);
	}

	/* ---- the conversation: bubbles ---- */
	.chat-wrap {
		position: relative;
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
	}
	.chat {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		padding: 0.75rem 0.875rem;
	}
	.day {
		display: flex;
		justify-content: center;
		margin: 0.5rem 0;
	}
	.day span {
		padding: 0.125rem 0.625rem;
		font-size: 0.6875rem;
		font-weight: 500;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--ledger-ink-muted);
		background: var(--ledger-paper-2);
		border-radius: 999px;
	}
	.row-system {
		margin: 0.5rem 0;
		font-size: 0.75rem;
		text-align: center;
		color: var(--ledger-ink-muted);
	}
	.msg {
		display: flex;
		align-items: flex-end;
		gap: 0.5rem;
		max-width: 88%;
	}
	.msg.first {
		margin-top: 0.5rem;
	}
	.msg.mine {
		align-self: flex-end;
		flex-direction: row-reverse;
	}
	.avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		flex-shrink: 0;
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--ledger-paper);
		background: var(--hotel-accent);
		border-radius: 999px;
	}
	.avatar.hidden-av {
		visibility: hidden;
	}
	.stack {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.125rem;
	}
	.msg.mine .stack {
		align-items: flex-end;
	}
	.who {
		margin-left: 0.25rem;
		font-size: 0.6875rem;
		font-weight: 500;
		color: var(--ledger-ink-muted);
	}
	.bubble {
		padding: 0.5rem 0.75rem;
		font-size: 0.9375rem;
		line-height: 1.45;
		white-space: pre-line;
		overflow-wrap: anywhere;
		color: var(--ledger-ink);
		background: var(--ledger-paper-2);
		border: 1px solid var(--ledger-rule);
		border-radius: 16px;
	}
	.msg.mine .bubble {
		color: var(--ledger-paper);
		background: var(--hotel-accent);
		border-color: var(--hotel-accent);
	}
	/* Square off the corner that touches the same sender's neighbour, so a run reads as one block. */
	.msg:not(.mine):not(.first) .bubble {
		border-top-left-radius: 5px;
	}
	.msg:not(.mine):not(.last) .bubble {
		border-bottom-left-radius: 5px;
	}
	.msg.mine:not(.first) .bubble {
		border-top-right-radius: 5px;
	}
	.msg.mine:not(.last) .bubble {
		border-bottom-right-radius: 5px;
	}
	.meta {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		margin: 0 0.25rem;
		font-family: 'JetBrains Mono Variable', ui-monospace, monospace;
		font-size: 0.625rem;
		color: var(--ledger-ink-muted);
	}
	.seen {
		display: inline-flex;
		align-items: center;
		gap: 0.125rem;
		font-family: 'Inter Variable', ui-sans-serif, sans-serif;
		font-size: 0.6875rem;
		color: var(--hotel-accent);
	}
	.bubble.typing {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.75rem 0.875rem;
	}
	.typing i {
		width: 0.375rem;
		height: 0.375rem;
		background: var(--ledger-ink-muted);
		border-radius: 999px;
		animation: dot 1.2s infinite ease-in-out;
	}
	.typing i:nth-child(2) {
		animation-delay: 0.15s;
	}
	.typing i:nth-child(3) {
		animation-delay: 0.3s;
	}
	@keyframes dot {
		0%,
		60%,
		100% {
			opacity: 0.35;
			transform: translateY(0);
		}
		30% {
			opacity: 1;
			transform: translateY(-3px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.typing i {
			animation: none;
			opacity: 0.7;
		}
	}
	.pill {
		position: absolute;
		bottom: 0.625rem;
		left: 50%;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.375rem 0.75rem;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--ledger-paper);
		background: var(--hotel-accent);
		border: 0;
		border-radius: 999px;
		box-shadow: 0 6px 16px -8px rgb(0 0 0 / 0.5);
		transform: translateX(-50%);
		cursor: pointer;
	}

	/* ---- chips, footer, buttons ---- */
	.chips {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.5rem;
		margin: 1rem 0 0;
		padding: 0;
		list-style: none;
	}
	.chip {
		display: block;
		width: 100%;
		padding: 0.625rem 0.875rem;
		font: inherit;
		font-size: 0.875rem;
		line-height: 1.35;
		text-align: left;
		color: var(--hotel-accent-deep);
		text-decoration: none;
		background: transparent;
		border: 1px solid var(--hotel-accent);
		border-radius: 8px;
		cursor: pointer;
	}
	.chip:hover {
		background: color-mix(in oklch, var(--hotel-accent) 10%, var(--ledger-paper));
	}
	.chip-link {
		font-weight: 600;
	}

	.foot,
	.composer {
		padding: 0.75rem 1rem 1rem;
		border-top: 1px solid var(--ledger-rule);
	}
	.presence {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0 0 0.625rem;
		font-size: 0.8125rem;
		color: var(--ledger-ink-muted);
	}
	.dot {
		width: 0.5rem;
		height: 0.5rem;
		border: 1px solid var(--ledger-ink-muted);
		border-radius: 999px;
	}
	.dot.on {
		background: var(--hotel-accent);
		border-color: var(--hotel-accent);
	}
	.primary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		min-height: 2.75rem;
		padding: 0.625rem 1rem;
		font: inherit;
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--ledger-paper);
		background: var(--hotel-accent);
		border: 0;
		border-radius: 8px;
		cursor: pointer;
	}
	.primary:hover:not(:disabled) {
		background: var(--hotel-accent-deep);
	}
	.primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.ghost {
		padding: 0.5rem 0.125rem;
		margin-bottom: 0.5rem;
		font: inherit;
		font-size: 0.8125rem;
		color: var(--ledger-ink-muted);
		background: none;
		border: 0;
		border-bottom: 1px solid var(--ledger-rule);
		cursor: pointer;
	}
	.ghost.end {
		margin: 0.5rem 0 0;
	}

	/* ---- forms: underline fields, as everywhere in the guest world ---- */
	.form {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
	}
	.field {
		display: block;
	}
	.label {
		display: block;
		font-size: 0.75rem;
		font-weight: 500;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--ledger-ink-muted);
	}
	.field input,
	.field textarea,
	.composer textarea {
		width: 100%;
		padding: 0.5rem 0.25rem;
		font: inherit;
		font-size: 0.9375rem;
		color: var(--ledger-ink);
		background: transparent;
		border: 0;
		border-bottom: 1px solid var(--ledger-rule);
		border-radius: 0;
		resize: none;
	}
	.field input:focus,
	.field textarea:focus,
	.composer textarea:focus {
		outline: none;
		border-bottom: 2px solid var(--hotel-accent);
	}
	.composer-row {
		display: flex;
		align-items: flex-end;
		gap: 0.5rem;
	}
	.send {
		min-height: 2.5rem;
		padding: 0 0.875rem;
		font: inherit;
		font-weight: 600;
		color: var(--ledger-paper);
		background: var(--hotel-accent);
		border: 0;
		border-radius: 8px;
		cursor: pointer;
	}
	.send:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.error {
		margin: 0 0 0.5rem;
		font-size: 0.8125rem;
		color: var(--ledger-danger, #b91c1c);
	}

	/* Phones: a full-screen sheet that follows the on-screen keyboard (visualViewport), the launcher collapses
	   to its icon. 16px fields stop iOS zooming in on focus. */
	@media (max-width: 639px) {
		.panel {
			position: fixed;
			top: var(--vvt, 0px);
			left: 0;
			right: 0;
			width: auto;
			height: var(--vvh, 100dvh);
			border: 0;
			border-radius: 0;
			box-shadow: none;
			padding-bottom: env(safe-area-inset-bottom);
		}
		.head {
			padding-top: calc(0.75rem + env(safe-area-inset-top));
		}
		.field input,
		.field textarea,
		.composer textarea {
			font-size: 1rem;
		}
		.launcher-label {
			display: none;
		}
		.launcher {
			width: 3.25rem;
			padding: 0;
			justify-content: center;
		}
		.support.lift {
			bottom: calc(5.25rem + var(--sf-bottom-bar, 0px));
		}
		/* The full-screen sheet has its own close button; the launcher would sit on its composer. */
		.support.is-open .launcher {
			display: none;
		}
	}

	@media print {
		.support {
			display: none;
		}
	}
</style>
