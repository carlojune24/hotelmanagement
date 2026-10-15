<script lang="ts">
	import { page } from '$app/state';
	import MessageCircleIcon from '@lucide/svelte/icons/message-circle';
	import XIcon from '@lucide/svelte/icons/x';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';

	/**
	 * Customer Support chat, guest side (Woven Ledger world): FAQ quick questions first, then a
	 * live chat with whichever staff member is available, or a leave-a-message form when nobody is.
	 * Anonymous — the server keeps the visitor's identity in an httpOnly cookie. Live updates
	 * arrive over SSE while a conversation is active; everything else is plain fetch.
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

	const api = $derived(`/${hotelSlug}/support`);
	const FLAG = $derived(`mm:support:${hotelSlug}`);

	let open = $state(false);
	let view = $state<View>('home');
	let loading = $state(false);
	let available = $state(false);
	let faqs = $state<Faq[]>([]);
	let activeFaq = $state<Faq | null>(null);

	let convId = $state<string | null>(null);
	let status = $state('');
	let agentName = $state<string | null>(null);
	let messages = $state<Msg[]>([]);
	let unread = $state(0);

	let name = $state('');
	let email = $state('');
	let firstMessage = $state('');
	let draft = $state('');
	let busy = $state(false);
	let error = $state('');

	let es: EventSource | null = null;
	let scroller: HTMLDivElement | undefined = $state();
	let panelEl: HTMLDivElement | undefined = $state();

	const live = $derived(status === 'queued' || status === 'open');
	const offlineMode = $derived(!available);

	function remember(on: boolean) {
		try {
			if (on) sessionStorage.setItem(FLAG, '1');
			else sessionStorage.removeItem(FLAG);
		} catch {
			/* storage blocked: the chat just won't resume after a full reload */
		}
	}
	function wasActive(): boolean {
		try {
			return sessionStorage.getItem(FLAG) === '1';
		} catch {
			return false;
		}
	}

	function closeStream() {
		es?.close();
		es = null;
	}

	function merge(incoming: Msg[]) {
		const have = new Set(messages.map((m) => m.id));
		const fresh = incoming.filter((m) => !have.has(m.id));
		if (fresh.length === 0) return;
		messages = [...messages, ...fresh].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
		if (!open) unread += fresh.filter((m) => m.direction !== 'guest').length;
	}

	function connect() {
		closeStream();
		if (!convId || !live) return;
		const after = messages.at(-1)?.createdAt ?? '';
		es = new EventSource(`${api}/stream?after=${encodeURIComponent(after)}`);
		es.addEventListener('update', (e) => {
			const u = JSON.parse((e as MessageEvent).data) as {
				conversationId: string;
				status: string;
				agentName: string | null;
				messages: Msg[];
			};
			if (u.conversationId !== convId) return;
			merge(u.messages);
			status = u.status;
			agentName = u.agentName;
			if (!(u.status === 'queued' || u.status === 'open')) closeStream();
		});
	}

	type State = {
		availability: { available: boolean };
		faqs: Faq[];
		conversation: { id: string; status: string; agentName: string | null; messages: Msg[] } | null;
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
				status = c.status;
				agentName = c.agentName;
				if (changed) messages = c.messages;
				else merge(c.messages);
				if (view === 'home' || changed) view = 'chat';
				if (!es) connect();
				remember(true);
			} else if (c && convId === c.id) {
				// our chat ended (by staff or the idle sweep)
				status = c.status;
				merge(c.messages);
				closeStream();
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
			void refresh();
		}
	});

	// Resume a chat after a full page load without hitting the server for visitors who never chatted.
	$effect(() => {
		if (wasActive()) void refresh();
		return closeStream;
	});

	// Staff replies seen while the chat is on screen count as read.
	$effect(() => {
		if (open && view === 'chat' && convId && messages.some((m) => m.direction === 'staff')) {
			void post({ action: 'read', conversationId: convId }).catch(() => {});
		}
	});

	// Pin the conversation to its newest message.
	$effect(() => {
		void messages.length;
		if (scroller) scroller.scrollTop = scroller.scrollHeight;
	});

	// Focus moves into the panel when it opens, back to nothing special when it closes.
	$effect(() => {
		if (open) panelEl?.focus();
	});

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
			if (offlineMode) {
				const { res, json } = await post({
					action: 'offline',
					name,
					email,
					message: firstMessage
				});
				if (json?.ok) {
					firstMessage = '';
					view = 'sent';
				} else {
					error = (json && 'message' in json && json.message) || (res.status === 429 ? 'Please wait a little before trying again.' : 'We could not send that. Please try again.');
				}
				return;
			}
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
			} else if (json && 'code' in json && json.code === 'offline') {
				// Everyone went away while the form was open.
				available = false;
				error = 'Nobody is online right now. Leave your message and we will email you back.';
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
				if (!es || es.readyState !== EventSource.OPEN) await refresh();
			} else {
				error = (json && 'message' in json && json.message) || 'We could not send that.';
			}
		} catch {
			error = 'You seem to be offline. Please check your connection.';
		} finally {
			busy = false;
		}
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
		status = '';
		messages = [];
		agentName = null;
		error = '';
		remember(false);
		view = 'home';
		void refresh();
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) open = false;
	}

	const clock = (iso: string) =>
		new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
</script>

<svelte:window onkeydown={onKeydown} />

<div class="support" class:lift class:is-open={open}>
	{#if open}
		<div
			class="panel"
			role="dialog"
			aria-label="Customer Support"
			tabindex="-1"
			bind:this={panelEl}
		>
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
							<li><a class="chip chip-link" href="/{hotelSlug}/dates">Book now</a></li>
						</ul>
					</div>
					<div class="foot">
						<p class="presence">
							<span class="dot" class:on={available} aria-hidden="true"></span>
							{available ? 'Our team is online' : 'Our team is offline right now'}
						</p>
						<button type="button" class="primary" onclick={chatWithPerson}>
							{available ? 'Chat with a person' : 'Leave a message'}
						</button>
					</div>
				{:else if view === 'faq' && activeFaq}
					<div class="scroll">
						<p class="row-guest">{activeFaq.question}</p>
						<p class="row-hotel">{activeFaq.answer}</p>
					</div>
					<div class="foot">
						<button type="button" class="ghost" onclick={() => (view = 'home')}>More questions</button>
						<button type="button" class="primary" onclick={chatWithPerson}>
							{available ? 'Still need help? Chat with a person' : 'Still need help? Leave a message'}
						</button>
					</div>
				{:else if view === 'form'}
					<form class="form scroll" onsubmit={submitForm}>
						<p class="row-hotel">
							{offlineMode
								? 'Nobody is online right now. Leave your question and we will reply by email.'
								: 'Tell us who you are and what you need. A team member will join the chat.'}
						</p>
						<label class="field">
							<span class="label">Your name</span>
							<input bind:value={name} required maxlength="80" autocomplete="name" />
						</label>
						<label class="field">
							<span class="label">Email{offlineMode ? '' : ' (optional)'}</span>
							<input type="email" bind:value={email} required={offlineMode} maxlength="200" autocomplete="email" />
						</label>
						<label class="field">
							<span class="label">{offlineMode ? 'Your message' : 'How can we help? (optional)'}</span>
							<textarea bind:value={firstMessage} rows="3" maxlength="1000" required={offlineMode}></textarea>
						</label>
						{#if error}<p class="error" role="alert">{error}</p>{/if}
						<button type="submit" class="primary" disabled={busy || !name.trim()}>
							{busy ? 'Sending…' : offlineMode ? 'Send message' : 'Start chat'}
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
					<div class="scroll" bind:this={scroller} aria-live="polite">
						{#each messages as m (m.id)}
							{#if m.direction === 'system'}
								<p class="row-system">{m.body}</p>
							{:else if m.direction === 'staff'}
								<div class="row-hotel">
									<span class="who">{agentName ?? 'Team'} <span class="ledger-data when">{clock(m.createdAt)}</span></span>
									{m.body}
								</div>
							{:else}
								<div class="row-guest">
									<span class="who">You <span class="ledger-data when">{clock(m.createdAt)}</span></span>
									{m.body}
								</div>
							{/if}
						{/each}
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
									onkeydown={(e) => {
										if (e.key === 'Enter' && !e.shiftKey) {
											e.preventDefault();
											e.currentTarget.form?.requestSubmit();
										}
									}}
								></textarea>
								<button type="submit" class="send" disabled={busy || !draft.trim()}>Send</button>
							</div>
							<button type="button" class="ghost end" onclick={endChat}>End chat</button>
						</form>
					{:else}
						<div class="foot">
							<p class="presence">This chat has ended.</p>
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
	}
	.launcher:hover {
		background: var(--hotel-accent-deep);
	}
	.launcher:focus-visible,
	.chip:focus-visible,
	.primary:focus-visible,
	.icon-btn:focus-visible,
	.send:focus-visible,
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

	/* ---- panel: a ruled sheet; only the header carries the weave ---- */
	.panel {
		display: flex;
		flex-direction: column;
		width: min(24rem, calc(100vw - 2.5rem));
		height: min(36rem, calc(100dvh - 8.5rem));
		overflow: hidden;
		background: var(--ledger-paper);
		border: 1px solid var(--ledger-rule);
		border-radius: 10px;
		outline: none;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 0.75rem 0.75rem 1rem;
		color: var(--ledger-paper);
		background-color: var(--hotel-accent);
		background-image: var(--hotel-woven-pattern);
		background-repeat: repeat;
		background-size: 28px 28px;
	}
	.head-title {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
		padding: 0.25rem 0.5rem;
		background: color-mix(in oklch, var(--hotel-accent-deep) 82%, transparent);
		border-radius: 4px;
	}
	.head-name {
		font-family: var(--ledger-font-display, Georgia, serif);
		font-size: 1.0625rem;
		font-weight: 500;
	}
	.head-sub {
		overflow: hidden;
		font-size: 0.75rem;
		text-overflow: ellipsis;
		white-space: nowrap;
		opacity: 0.9;
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
		background: color-mix(in oklch, var(--hotel-accent-deep) 60%, transparent);
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
	}

	/* ---- ledger rows instead of speech bubbles ---- */
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
	.row-hotel .who {
		color: var(--hotel-accent-deep);
	}
	.row-guest {
		text-align: right;
	}
	.row-system {
		margin: 0;
		padding: 0.5rem 0;
		font-size: 0.75rem;
		text-align: center;
		color: var(--ledger-ink-muted);
	}
	.who {
		display: block;
		margin-bottom: 0.125rem;
		font-size: 0.6875rem;
		font-weight: 500;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--ledger-ink-muted);
	}
	.when {
		margin-left: 0.375rem;
		letter-spacing: 0;
		text-transform: none;
	}
	.muted {
		font-size: 0.875rem;
		color: var(--ledger-ink-muted);
	}

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
		border-radius: 4px;
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
		border-radius: 4px;
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
		border-radius: 4px;
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

	/* Phones: the panel is a full-screen sheet, the launcher collapses to its icon. */
	@media (max-width: 639px) {
		.panel {
			position: fixed;
			inset: 0;
			width: auto;
			height: auto;
			border: 0;
			border-radius: 0;
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
