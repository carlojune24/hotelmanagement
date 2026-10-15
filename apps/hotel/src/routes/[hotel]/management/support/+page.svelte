<script lang="ts">
	import { page } from '$app/state';
	import { deserialize, enhance } from '$app/forms';
	import { getContext, tick } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import MessageSquareIcon from '@lucide/svelte/icons/message-square';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import MailIcon from '@lucide/svelte/icons/mail';
	import BellIcon from '@lucide/svelte/icons/bell';
	import BellRingIcon from '@lucide/svelte/icons/bell-ring';
	import Volume2Icon from '@lucide/svelte/icons/volume-2';
	import VolumeXIcon from '@lucide/svelte/icons/volume-x';
	import CheckCheckIcon from '@lucide/svelte/icons/check-check';
	import ZapIcon from '@lucide/svelte/icons/zap';
	import { relativeTime } from '$lib/dining-messages';
	import { fillCanned } from '$lib/support-canned';
	import type { SupportLive } from '$lib/support-live.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/** The staff app's live line to Support (opened by the management layout on every page). */
	const live = getContext<SupportLive>('support-live');

	const base = $derived(`/${page.params.hotel}/management/support`);
	const bookingHref = (orderId: string) => `/${page.params.hotel}/management/transactions/${orderId}`;
	const peso = (c: number) =>
		`₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

	const TABS = [
		{ id: 'queued', label: 'Queued' },
		{ id: 'mine', label: 'Mine' },
		{ id: 'all', label: 'All open' },
		{ id: 'closed', label: 'Closed' }
	] as const;
	const tabCount = (id: string) =>
		id === 'queued' ? data.counts.queued : id === 'mine' ? data.counts.mine : null;

	const STATUS_LABEL: Record<string, string> = {
		queued: 'Waiting',
		open: 'Live',
		closed: 'Closed',
		offline_message: 'Left a message'
	};
	const statusClass = (s: string) =>
		s === 'open'
			? 'bg-success/15 text-ink'
			: s === 'queued' || s === 'offline_message'
				? 'bg-warning/15 text-ink'
				: 'bg-surface-2 text-ink-muted';

	let draft = $state('');
	let sending = $state(false);
	let nowMs = $state(Date.now());
	let scroller: HTMLDivElement | undefined = $state();
	let replyBox: HTMLTextAreaElement | null = $state(null);
	let takeOverOpen = $state(false);
	let cannedOpen = $state(false);
	let cannedIndex = $state(0);
	let tabVisible = $state(true);

	// What the agent sees: the live line's report, falling back to the page's own read before it connects.
	const agentOn = $derived(live.available ?? data.agent.available);

	const selected = $derived(data.conversations.find((c) => c.id === data.selectedId) ?? null);
	const detail = $derived(data.detail);
	const isOffline = $derived(detail?.status === 'offline_message');
	const isClosed = $derived(detail?.status === 'closed');
	const mineNow = $derived(detail?.assignedUserId === data.currentUserId);
	const guestTyping = $derived(live.isTyping(detail?.id));

	/** The newest of this agent's messages the guest has read: the one that gets "Seen". */
	const seenMessageId = $derived.by(() => {
		const msgs = detail?.messages ?? [];
		for (let i = msgs.length - 1; i >= 0; i--) {
			const m = msgs[i]!;
			if (m.direction === 'staff' && m.readAt) return m.id;
		}
		return null;
	});

	const href = (id: string | null, tab: string = data.tab) => {
		const p = new URLSearchParams();
		if (tab !== 'all') p.set('tab', tab);
		if (id) p.set('c', id);
		const s = p.toString();
		return `${base}${s ? `?${s}` : ''}`;
	};

	const stamp = (iso: string | Date) =>
		new Intl.DateTimeFormat('en-PH', {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
			timeZone: data.timezone
		}).format(new Date(iso));

	/** Posts a form action without navigating (for the small background calls: read, typing). */
	async function postAction(name: string, fields: Record<string, string>) {
		const body = new FormData();
		for (const [k, v] of Object.entries(fields)) body.set(k, v);
		try {
			const res = await fetch(`${base}?/${name}`, {
				method: 'POST',
				headers: { 'x-sveltekit-action': 'true' },
				body
			});
			return deserialize(await res.text());
		} catch {
			return null; // offline for a moment; the next call retries
		}
	}

	// Keep the thread pinned to its newest message.
	$effect(() => {
		void detail?.messages.length;
		void guestTyping;
		if (scroller) scroller.scrollTop = scroller.scrollHeight;
	});

	// Live updates: the shared stream pings on every change and this page re-reads its own data.
	$effect(() =>
		live.onChange(() => {
			void invalidateSupport();
		})
	);
	async function invalidateSupport() {
		const { invalidate } = await import('$app/navigation');
		await invalidate('app:support');
	}

	$effect(() => {
		const tick = setInterval(() => (nowMs = Date.now()), 30_000);
		const onVis = () => (tabVisible = !document.hidden);
		document.addEventListener('visibilitychange', onVis);
		onVis();
		return () => {
			clearInterval(tick);
			document.removeEventListener('visibilitychange', onVis);
		};
	});

	// "Seen": once the thread is actually on screen, the guest's messages are marked read (and the guest is told).
	// Done here, not in the page load, so a live reload never rewrites them.
	let markedKey = '';
	$effect(() => {
		const d = detail;
		if (!d || !tabVisible) return;
		const unread = d.messages.filter((m) => m.direction === 'guest' && !m.readAt).length;
		if (unread === 0) {
			markedKey = '';
			return;
		}
		const key = `${d.id}:${unread}`;
		if (key === markedKey) return;
		markedKey = key;
		void postAction('read', { conversationId: d.id });
	});

	// "Typing…" for the guest: at most one signal every 2.5 s, never for an emailed (offline) reply.
	let lastTypingAt = 0;
	function signalTyping() {
		if (!detail || isOffline || isClosed) return;
		const now = Date.now();
		if (now - lastTypingAt < 2500) return;
		lastTypingAt = now;
		void postAction('typing', { conversationId: detail.id });
	}

	// ---- canned replies: type "/" to search, or open the list
	const slashQuery = $derived(draft.startsWith('/') && !draft.includes('\n') ? draft.slice(1).trim().toLowerCase() : null);
	const cannedShown = $derived(
		data.canned.filter((r) => {
			if (slashQuery === null || slashQuery === '') return true;
			return r.title.toLowerCase().includes(slashQuery) || r.body.toLowerCase().includes(slashQuery);
		})
	);
	const pickerOpen = $derived(cannedOpen || slashQuery !== null);
	$effect(() => {
		void cannedShown.length;
		cannedIndex = 0;
	});
	function useCanned(r: { body: string }) {
		draft = fillCanned(r.body, {
			guest: detail?.guestName?.split(/\s+/)[0] ?? 'there',
			...data.cannedContext
		});
		cannedOpen = false;
		void tick().then(() => replyBox?.focus());
	}
	function onReplyKeydown(e: KeyboardEvent) {
		if (e.isComposing) return;
		if (pickerOpen && cannedShown.length > 0) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				cannedIndex = (cannedIndex + 1) % cannedShown.length;
				return;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				cannedIndex = (cannedIndex - 1 + cannedShown.length) % cannedShown.length;
				return;
			}
			if (e.key === 'Enter' && slashQuery !== null) {
				e.preventDefault();
				useCanned(cannedShown[cannedIndex]!);
				return;
			}
		}
		if (e.key === 'Escape' && pickerOpen) {
			cannedOpen = false;
			if (slashQuery !== null) draft = '';
			return;
		}
		if (e.key === 'Enter' && !e.shiftKey && draft.trim()) {
			e.preventDefault();
			(e.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
		}
	}

	$effect(() => {
		if (form && 'error' in form && form.error) toast.error(form.error);
		if (form && 'byEmail' in form && form.byEmail)
			toast[form.emailed ? 'success' : 'error'](
				form.emailed ? 'Reply sent by email.' : 'Reply saved, but the email could not be sent.'
			);
	});
</script>

<svelte:head><title>Support inbox</title></svelte:head>

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
	<div class="mb-4 flex flex-wrap items-center gap-2">
		<nav class="flex flex-wrap gap-1.5" aria-label="Filter conversations">
			{#each TABS as t (t.id)}
				<a
					href={href(data.selectedId, t.id)}
					aria-current={data.tab === t.id ? 'true' : undefined}
					class="inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm {data.tab === t.id
						? 'border-brand bg-brand/10 font-medium text-ink'
						: 'border-border text-ink-muted hover:text-ink'}"
				>
					{t.label}{#if tabCount(t.id) !== null}<span class="tabular-nums text-xs">{tabCount(t.id)}</span>{/if}
				</a>
			{/each}
		</nav>

		<div class="ml-auto flex flex-wrap items-center gap-3">
			{#if data.canManage}
				<a href="{base}/replies" class="text-sm text-brand underline underline-offset-2">Canned replies</a>
				<a href="{base}/faq" class="text-sm text-brand underline underline-offset-2">Edit FAQ</a>
			{/if}
			<button
				type="button"
				class="inline-flex size-9 items-center justify-center rounded-full border border-border text-ink-muted hover:text-ink"
				aria-pressed={live.soundOn}
				aria-label={live.soundOn ? 'Mute new-chat sound' : 'Turn on new-chat sound'}
				title={live.soundOn ? 'New-chat sound is on' : 'New-chat sound is off'}
				onclick={() => live.toggleSound()}
			>
				{#if live.soundOn}<Volume2Icon class="size-4" aria-hidden="true" />{:else}<VolumeXIcon class="size-4" aria-hidden="true" />{/if}
			</button>
			{#if live.notifications === 'default'}
				<button
					type="button"
					class="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-sm text-ink-muted hover:text-ink"
					title="Get a desktop notification for new chats while this tab is in the background"
					onclick={() => live.enableNotifications()}
				>
					<BellIcon class="size-4" aria-hidden="true" /> Enable alerts
				</button>
			{:else if live.notifications === 'granted'}
				<span class="inline-flex items-center gap-1 text-xs text-ink-muted" title="Desktop notifications are on"><BellRingIcon class="size-4" aria-hidden="true" /> Alerts on</span>
			{/if}
			<span class="inline-flex items-center gap-1.5 text-xs text-ink-muted" title="Live connection to the guest chat">
				<span class="size-2 rounded-full {live.connected ? 'bg-success' : 'bg-border'}" aria-hidden="true"></span>
				{live.connected ? 'Live' : 'Reconnecting…'}
			</span>
			<form
				method="POST"
				action="?/available"
				use:enhance={({ formData }) => {
					// Decide the target from the state NOW and send exactly that; flipping the button's own state
					// first used to make the form post the old value, so nothing ever changed.
					const target = !agentOn;
					formData.set('available', target ? '1' : '0');
					const before = live.available;
					live.available = target;
					return async ({ result, update }) => {
						if (result.type === 'success' && result.data && 'available' in result.data) {
							live.available = Boolean(result.data.available);
						} else {
							live.available = before;
							toast.error('Could not change your availability. Please try again.');
						}
						await update({ reset: false });
					};
				}}
			>
				<button
					type="submit"
					role="switch"
					aria-checked={agentOn}
					class="inline-flex h-9 items-center gap-2 rounded-full border px-3 text-sm {agentOn
						? 'border-success bg-success/15 font-medium text-ink'
						: 'border-border text-ink-muted hover:text-ink'}"
				>
					<span class="size-2.5 rounded-full {agentOn ? 'bg-success' : 'bg-ink-muted/40'}" aria-hidden="true"></span>
					{agentOn ? "I'm available" : "I'm away"}
				</button>
			</form>
		</div>
	</div>

	{#if !agentOn}
		<p class="mb-4 rounded-lg border border-border bg-surface-2/60 px-4 py-2.5 text-sm text-ink-muted">
			You are away, so new chats won't be assigned to you. Switch on <strong class="text-ink">I'm available</strong> to take chats. You stay available on every staff page while this browser tab is open.
		</p>
	{/if}

	{#if data.conversations.length === 0 && !data.selectedId}
		<div class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-12 text-center">
			<MessageSquareIcon class="size-6 text-ink-muted" aria-hidden="true" />
			<p class="text-sm text-ink-muted">
				{data.tab === 'closed' ? 'No closed chats yet. A chat\'s messages are deleted when it closes.' : 'No chats right now. When a guest writes in, it appears here, even while nobody is online.'}
			</p>
		</div>
	{:else}
		<div class="grid gap-4 lg:grid-cols-[22rem_1fr]">
			<!-- Conversations. On a phone the list gives way to the open conversation. -->
			<section aria-label="Conversations" class="{selected ? 'hidden lg:block' : ''} min-w-0">
				{#if data.conversations.length === 0}
					<p class="rounded-xl border border-dashed border-border p-6 text-center text-sm text-ink-muted">Nothing in this tab.</p>
				{:else}
					<ul class="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
						{#each data.conversations as c (c.id)}
							<li>
								<a
									href={href(c.id)}
									aria-current={c.id === data.selectedId ? 'true' : undefined}
									class="block px-4 py-3 hover:bg-surface-2/60 {c.id === data.selectedId ? 'bg-brand/5' : ''}"
								>
									<span class="flex items-start justify-between gap-2">
										<span class="min-w-0 truncate text-sm {c.unread > 0 ? 'font-semibold' : 'font-medium'} text-ink">{c.guestName ?? 'Guest'}</span>
										<span class="shrink-0 text-xs tabular-nums text-ink-muted">{relativeTime(new Date(c.lastMessageAt).toISOString(), nowMs, data.timezone)}</span>
									</span>
									<span class="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
										<span class="rounded px-1.5 py-0.5 font-semibold {statusClass(c.status)}">{STATUS_LABEL[c.status]}</span>
										{#if c.assignedName}<span class="text-ink-muted">{c.assignedUserId === data.currentUserId ? 'You' : c.assignedName}</span>{/if}
										{#if c.orderCode}<span class="font-mono text-ink-muted">{c.orderCode}</span>{/if}
									</span>
									<span class="mt-1 flex items-center gap-2">
										{#if live.isTyping(c.id)}
											<span class="min-w-0 flex-1 truncate text-sm italic text-brand">typing…</span>
										{:else}
											<span class="min-w-0 flex-1 truncate text-sm {c.unread > 0 ? 'text-ink' : 'text-ink-muted'}">{c.preview ?? (c.status === 'closed' ? 'Messages deleted' : 'No messages yet')}</span>
										{/if}
										{#if c.unread > 0}
											<span class="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold tabular-nums text-brand-ink" aria-label="{c.unread} unread">{c.unread}</span>
										{/if}
									</span>
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<!-- The open conversation -->
			<section aria-label="Conversation" class="{selected || detail ? '' : 'hidden lg:block'} min-w-0">
				{#if !detail}
					<div class="flex h-full min-h-64 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-8 text-center">
						<MessageSquareIcon class="size-6 text-ink-muted" aria-hidden="true" />
						<p class="text-sm text-ink-muted">Choose a conversation to read and reply.</p>
					</div>
				{:else}
					<div class="overflow-hidden rounded-xl border border-border bg-surface">
						<div class="border-b border-border px-5 py-4">
							<a href={href(null)} class="mb-2 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink lg:hidden">
								<ArrowLeftIcon class="size-4" aria-hidden="true" /> All chats
							</a>
							<div class="flex flex-wrap items-center gap-2">
								<h2 class="text-base font-semibold text-ink">{detail.guestName ?? 'Guest'}</h2>
								<span class="rounded px-1.5 py-0.5 text-xs font-semibold {statusClass(detail.status)}">{STATUS_LABEL[detail.status]}</span>
								<span class="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-ink-muted" title="This chat's unique ID">{detail.ref}</span>
								{#if detail.previousChats > 0}
									<span class="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-ink-muted" title="Chats this guest started before">Returning guest · {detail.previousChats} earlier</span>
								{/if}
							</div>
							{#if detail.guestEmail}
								<a href="mailto:{detail.guestEmail}" class="mt-1 inline-flex items-center gap-1 text-sm text-ink-muted underline-offset-2 hover:underline">
									<MailIcon class="size-3.5" aria-hidden="true" />{detail.guestEmail}
								</a>
							{/if}
							<dl class="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
								<div class="flex justify-between gap-3"><dt class="text-ink-muted">Started</dt><dd>{stamp(detail.createdAt)}</dd></div>
								<div class="flex justify-between gap-3"><dt class="text-ink-muted">Agent</dt><dd>{detail.assignedName ? (mineNow ? 'You' : detail.assignedName) : 'Nobody yet'}</dd></div>
								{#if detail.order}
									<div class="flex justify-between gap-3">
										<dt class="text-ink-muted">Booking</dt>
										<dd><a href={bookingHref(detail.order.id)} class="font-mono text-brand underline underline-offset-2">{detail.order.code}</a></dd>
									</div>
									<div class="flex justify-between gap-3"><dt class="text-ink-muted">Booking status</dt><dd class="capitalize">{detail.order.status.replace('_', ' ')} · {peso(detail.order.totalCentavos)}</dd></div>
								{/if}
							</dl>
							{#if !isClosed}
								<div class="mt-3 flex flex-wrap gap-2">
									{#if !mineNow && !isOffline}
										{#if detail.assignedUserId}
											<!-- Taking a colleague's live chat is a hand-over: ask first. -->
											<Button type="button" size="sm" onclick={() => (takeOverOpen = true)}>Take over</Button>
										{:else}
											<form method="POST" action="?/claim" use:enhance>
												<input type="hidden" name="conversationId" value={detail.id} />
												<Button type="submit" size="sm">Take this chat</Button>
											</form>
										{/if}
									{/if}
									<form method="POST" action="?/close" use:enhance>
										<input type="hidden" name="conversationId" value={detail.id} />
										<Button type="submit" size="sm" variant="outline">Close chat</Button>
									</form>
								</div>
							{/if}
						</div>

						<div bind:this={scroller} class="h-[clamp(14rem,calc(100dvh-30rem),38rem)] space-y-3 overflow-y-auto px-5 py-4" aria-live="polite">
							{#each detail.messages as m (m.id)}
								{#if m.direction === 'system'}
									<p class="text-center text-xs text-ink-muted">{m.body}</p>
								{:else}
									<div class="flex flex-col {m.direction === 'staff' ? 'items-end' : 'items-start'}">
										<div class="max-w-[85%] rounded-lg px-3 py-2 text-sm {m.direction === 'staff' ? 'bg-brand/10 text-ink' : 'bg-surface-2 text-ink'}">
											<p class="whitespace-pre-line">{m.body}</p>
											<p class="mt-1 text-[11px] text-ink-muted">
												{m.direction === 'staff' ? (m.authorName ?? 'Staff') : (detail.guestName ?? 'Guest')} · {stamp(m.createdAt)}
											</p>
										</div>
										{#if m.id === seenMessageId}
											<p class="mt-0.5 inline-flex items-center gap-1 text-[11px] text-ink-muted">
												<CheckCheckIcon class="size-3.5 text-brand" aria-hidden="true" /> Seen {m.readAt ? stamp(m.readAt) : ''}
											</p>
										{/if}
									</div>
								{/if}
							{/each}
							{#if guestTyping}
								<div class="flex justify-start" aria-live="polite">
									<p class="rounded-lg bg-surface-2 px-3 py-2 text-sm italic text-ink-muted">{detail.guestName ?? 'The guest'} is typing…</p>
								</div>
							{/if}
						</div>

						{#if isClosed}
							<p class="border-t border-border px-5 py-4 text-sm text-ink-muted">This chat is closed. Its messages were deleted when it ended; this record keeps only who, when and the booking.</p>
						{:else}
							<form
								method="POST"
								action="?/reply"
								class="relative space-y-2 border-t border-border px-5 py-4"
								use:enhance={() => {
									sending = true;
									return async ({ result, update }) => {
										await update({ reset: false });
										sending = false;
										if (result.type === 'success') draft = '';
									};
								}}
							>
								<input type="hidden" name="conversationId" value={detail.id} />

								{#if pickerOpen}
									<div class="absolute inset-x-5 bottom-[calc(100%-3.25rem)] z-10 max-h-56 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg" role="listbox" aria-label="Canned replies">
										{#each cannedShown as r, i (r.id)}
											<button
												type="button"
												role="option"
												aria-selected={i === cannedIndex}
												class="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-surface-2 {i === cannedIndex ? 'bg-surface-2' : ''}"
												onclick={() => useCanned(r)}
											>
												<span class="block font-medium text-ink">{r.title}</span>
												<span class="block truncate text-xs text-ink-muted">{fillCanned(r.body, { guest: detail.guestName?.split(/\s+/)[0] ?? 'there', ...data.cannedContext })}</span>
											</button>
										{:else}
											<p class="px-3 py-2 text-sm text-ink-muted">
												{data.canned.length === 0 ? 'No canned replies yet.' : 'No reply matches.'}
												{#if data.canManage && data.canned.length === 0}<a href="{base}/replies" class="text-brand underline">Add some</a>{/if}
											</p>
										{/each}
									</div>
								{/if}

								<div class="flex items-center justify-between gap-2">
									<button
										type="button"
										class="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-xs text-ink-muted hover:text-ink"
										aria-expanded={pickerOpen}
										onclick={() => (cannedOpen = !cannedOpen)}
									>
										<ZapIcon class="size-3.5" aria-hidden="true" /> Quick replies
									</button>
									<span class="text-xs text-ink-muted">Type <kbd class="rounded border border-border px-1">/</kbd> to search</span>
								</div>
								<Textarea
									name="body"
									bind:value={draft}
									bind:ref={replyBox}
									rows={2}
									maxlength={1000}
									placeholder={isOffline ? `Reply to ${detail.guestName ?? 'the guest'} by email` : `Reply to ${detail.guestName ?? 'the guest'}`}
									aria-label="Reply to the guest"
									class="min-h-0"
									oninput={signalTyping}
									onkeydown={onReplyKeydown}
								/>
								<div class="flex items-center justify-between gap-3">
									<p class="text-xs text-ink-muted">
										{isOffline ? 'Sent to their email address, then the message is closed.' : 'Enter sends, Shift+Enter adds a line. Appears in the guest\'s chat window straight away.'}
									</p>
									<Button type="submit" disabled={sending || !draft.trim()}>{sending ? 'Sending…' : 'Send reply'}</Button>
								</div>
							</form>
						{/if}
					</div>
				{/if}
			</section>
		</div>
	{/if}
</div>

<!-- Taking over a colleague's live chat -->
<Dialog.Root bind:open={takeOverOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Take over this chat?</Dialog.Title>
			<Dialog.Description>
				{detail?.assignedName ?? 'A colleague'} is talking with {detail?.guestName ?? 'this guest'}. If you take over, the chat moves to you and the guest sees that you joined.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button type="button" variant="outline" onclick={() => (takeOverOpen = false)}>Keep it with {detail?.assignedName ?? 'them'}</Button>
			<form method="POST" action="?/claim" use:enhance={() => async ({ update }) => { takeOverOpen = false; await update({ reset: false }); }}>
				<input type="hidden" name="conversationId" value={detail?.id ?? ''} />
				<Button type="submit">Take over</Button>
			</form>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
