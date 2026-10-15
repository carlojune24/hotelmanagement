<script lang="ts">
	import { page } from '$app/state';
	import { deserialize, enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import MessageSquareIcon from '@lucide/svelte/icons/message-square';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import MailIcon from '@lucide/svelte/icons/mail';
	import { relativeTime } from '$lib/dining-messages';
	import { playTone, readSoundPref, unlockOnFirstTouch } from '$lib/staff-sound';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}/management/support`);
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

	// Canned replies: one tap drops the text into the box so it can still be edited.
	const CANNED = [
		'Thanks for reaching out. Let me check that for you.',
		'Our check-in is from 2:00 PM and check-out is by 12:00 noon.',
		'You can pay online with GCash, Maya, card or QR Ph when you confirm your booking.',
		'Is there anything else I can help you with?'
	];

	let draft = $state('');
	let sending = $state(false);
	let nowMs = $state(Date.now());
	let agentOn = $state(data.agent.available);
	let live = $state(false);
	let soundOn = $state(true);
	let scroller: HTMLDivElement | undefined = $state();

	$effect(() => {
		agentOn = data.agent.available;
	});

	const selected = $derived(data.conversations.find((c) => c.id === data.selectedId) ?? null);
	const detail = $derived(data.detail);
	const isOffline = $derived(detail?.status === 'offline_message');
	const isClosed = $derived(detail?.status === 'closed');
	const mineNow = $derived(detail?.assignedUserId === data.currentUserId);

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

	// Keep the thread pinned to its newest message.
	$effect(() => {
		void detail?.messages.length;
		if (scroller) scroller.scrollTop = scroller.scrollHeight;
	});

	// Live updates: the server pings on every change and the page re-reads its own data.
	$effect(() => {
		soundOn = readSoundPref('mm:support-sound');
		const stopUnlock = unlockOnFirstTouch();
		const es = new EventSource(`${base}/stream`);
		es.addEventListener('ready', () => (live = true));
		es.addEventListener('change', (e) => {
			const { kind } = JSON.parse((e as MessageEvent).data) as { kind: string };
			void invalidate('app:support');
			void invalidate('app:staff-badges');
			if (soundOn && (kind === 'new_conversation' || kind === 'guest_message')) playTone('ticket', 2);
		});
		es.onerror = () => (live = false);
		const tick = setInterval(() => (nowMs = Date.now()), 30_000);
		return () => {
			es.close();
			stopUnlock();
			clearInterval(tick);
		};
	});

	// Heartbeat: an open inbox tab is what keeps an available agent "online" for routing.
	$effect(() => {
		const beat = async () => {
			try {
				const res = await fetch(`${base}?/heartbeat`, {
					method: 'POST',
					headers: { 'x-sveltekit-action': 'true' },
					body: new FormData()
				});
				const result = deserialize(await res.text());
				if (result.type === 'success' && result.data?.available === true) agentOn = true;
			} catch {
				/* offline for a moment; the next beat retries */
			}
		};
		const t = setInterval(beat, 15_000);
		return () => clearInterval(t);
	});

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
				<a href="{base}/faq" class="text-sm text-brand underline underline-offset-2">Edit FAQ</a>
			{/if}
			<span class="inline-flex items-center gap-1.5 text-xs text-ink-muted" title="Live connection to the guest chat">
				<span class="size-2 rounded-full {live ? 'bg-success' : 'bg-border'}" aria-hidden="true"></span>
				{live ? 'Live' : 'Reconnecting…'}
			</span>
			<form
				method="POST"
				action="?/available"
				use:enhance={() => {
					return async ({ update }) => {
						await update({ reset: false });
					};
				}}
			>
				<input type="hidden" name="available" value={agentOn ? '0' : '1'} />
				<button
					type="submit"
					role="switch"
					aria-checked={agentOn}
					class="inline-flex h-9 items-center gap-2 rounded-full border px-3 text-sm {agentOn
						? 'border-success bg-success/15 font-medium text-ink'
						: 'border-border text-ink-muted hover:text-ink'}"
					onclick={() => (agentOn = !agentOn)}
				>
					<span class="size-2.5 rounded-full {agentOn ? 'bg-success' : 'bg-ink-muted/40'}" aria-hidden="true"></span>
					{agentOn ? "I'm available" : "I'm away"}
				</button>
			</form>
		</div>
	</div>

	{#if !agentOn}
		<p class="mb-4 rounded-lg border border-border bg-surface-2/60 px-4 py-2.5 text-sm text-ink-muted">
			You are away, so new chats won't be assigned to you. Switch on <strong class="text-ink">I'm available</strong> and keep this page open to take chats.
		</p>
	{/if}

	{#if data.conversations.length === 0 && !data.selectedId}
		<div class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-12 text-center">
			<MessageSquareIcon class="size-6 text-ink-muted" aria-hidden="true" />
			<p class="text-sm text-ink-muted">
				{data.tab === 'closed' ? 'No closed chats yet.' : 'No chats right now. When a guest writes in, it appears here.'}
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
										<span class="min-w-0 flex-1 truncate text-sm {c.unread > 0 ? 'text-ink' : 'text-ink-muted'}">{c.preview ?? 'No messages yet'}</span>
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
									<div class="flex justify-between gap-3"><dt class="text-ink-muted">Booking</dt><dd class="font-mono">{detail.order.code}</dd></div>
									<div class="flex justify-between gap-3"><dt class="text-ink-muted">Booking status</dt><dd class="capitalize">{detail.order.status.replace('_', ' ')} · {peso(detail.order.totalCentavos)}</dd></div>
								{/if}
							</dl>
							{#if !isClosed}
								<div class="mt-3 flex flex-wrap gap-2">
									{#if !mineNow && !isOffline}
										<form method="POST" action="?/claim" use:enhance>
											<input type="hidden" name="conversationId" value={detail.id} />
											<Button type="submit" size="sm">{detail.assignedUserId ? 'Take over' : 'Take this chat'}</Button>
										</form>
									{/if}
									<form method="POST" action="?/close" use:enhance>
										<input type="hidden" name="conversationId" value={detail.id} />
										<Button type="submit" size="sm" variant="outline">Close chat</Button>
									</form>
								</div>
							{/if}
						</div>

						<div bind:this={scroller} class="max-h-[50vh] min-h-48 space-y-3 overflow-y-auto px-5 py-4" aria-live="polite">
							{#each detail.messages as m (m.id)}
								{#if m.direction === 'system'}
									<p class="text-center text-xs text-ink-muted">{m.body}</p>
								{:else}
									<div class="flex {m.direction === 'staff' ? 'justify-end' : 'justify-start'}">
										<div class="max-w-[85%] rounded-lg px-3 py-2 text-sm {m.direction === 'staff' ? 'bg-brand/10 text-ink' : 'bg-surface-2 text-ink'}">
											<p class="whitespace-pre-line">{m.body}</p>
											<p class="mt-1 text-[11px] text-ink-muted">
												{m.direction === 'staff' ? (m.authorName ?? 'Staff') : (detail.guestName ?? 'Guest')} · {stamp(m.createdAt)}
											</p>
										</div>
									</div>
								{/if}
							{/each}
						</div>

						{#if isClosed}
							<p class="border-t border-border px-5 py-4 text-sm text-ink-muted">This chat is closed.</p>
						{:else}
							<form
								method="POST"
								action="?/reply"
								class="space-y-2 border-t border-border px-5 py-4"
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
								<div class="flex flex-wrap gap-1.5">
									{#each CANNED as text (text)}
										<button
											type="button"
											class="max-w-full truncate rounded-full border border-border px-2.5 py-1 text-xs text-ink-muted hover:text-ink"
											onclick={() => (draft = draft ? `${draft} ${text}` : text)}
										>{text}</button>
									{/each}
								</div>
								<Textarea
									name="body"
									bind:value={draft}
									rows={2}
									maxlength={1000}
									placeholder={isOffline ? `Reply to ${detail.guestName ?? 'the guest'} by email` : `Reply to ${detail.guestName ?? 'the guest'}`}
									aria-label="Reply to the guest"
									class="min-h-0"
								/>
								<div class="flex items-center justify-between gap-3">
									<p class="text-xs text-ink-muted">
										{isOffline ? 'Sent to their email address, then the message is closed.' : 'Appears in the guest\'s chat window straight away.'}
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
