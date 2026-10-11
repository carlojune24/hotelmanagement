<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import MessageSquareIcon from '@lucide/svelte/icons/message-square';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import {
		THREAD_FILTERS,
		THREAD_KIND_LABEL,
		matchesFilter,
		matchesQuery,
		relativeTime,
		type ThreadFilter
	} from '$lib/dining-messages';
	import { ORDER_STATUS_LABEL, type OrderStatus } from '$lib/dining-orders';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}/management/dining`);
	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

	let query = $state('');
	let draft = $state('');
	let sending = $state(false);
	let nowMs = $state(Date.now());

	const FILTER_LABEL: Record<ThreadFilter, string> = {
		all: 'All',
		unread: 'Unread',
		pickup: 'Pickup',
		delivery: 'Delivery',
		reservation: 'Reservations'
	};
	const counts = $derived.by(() => {
		const out = {} as Record<ThreadFilter, number>;
		for (const f of THREAD_FILTERS) out[f] = data.threads.filter((t) => matchesFilter(t, f)).length;
		return out;
	});
	const visible = $derived(data.threads.filter((t) => matchesFilter(t, data.filter) && matchesQuery(t, query)));
	const selected = $derived(data.threads.find((t) => t.orderId === data.selectedId) ?? null);

	const href = (orderId: string | null, filter: ThreadFilter = data.filter) => {
		const p = new URLSearchParams();
		if (filter !== 'all') p.set('filter', filter);
		if (orderId) p.set('order', orderId);
		const s = p.toString();
		return `${base}/messages${s ? `?${s}` : ''}`;
	};

	const stamp = (iso: string) =>
		new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: data.timezone }).format(new Date(iso));
	const slot = (iso: string) =>
		new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: data.timezone }).format(new Date(iso));

	// Keep the list and the open conversation current without a manual refresh.
	$effect(() => {
		const tick = setInterval(() => {
			nowMs = Date.now();
			void invalidate('app:dining-messages');
		}, 15_000);
		return () => clearInterval(tick);
	});

	// Opening a conversation reads it, so refresh the tab badge straight away.
	$effect(() => {
		if (data.selectedId) void invalidate('app:dining-alerts');
	});

	$effect(() => {
		if (form && 'error' in form && form.error) toast.error(form.error);
	});

	const payLabel = (s: string) =>
		s === 'paid' ? 'Paid' : s === 'refunded' ? 'Refunded' : s === 'room_charged' ? 'Charged to room' : 'Not paid yet';
	const statusLabel = (s: string) => ORDER_STATUS_LABEL[s as OrderStatus] ?? s;

	const kindClass = (kind: string) =>
		kind === 'delivery' || kind === 'pickup'
			? 'bg-brand/10 text-brand'
			: kind === 'reservation'
				? 'bg-warning/15 text-ink'
				: 'bg-surface-2 text-ink-muted';
</script>

<svelte:head><title>Messages · Dining</title></svelte:head>

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
	<div class="mb-4 flex flex-wrap items-center gap-2">
		<nav class="flex flex-wrap gap-1.5" aria-label="Filter conversations">
			{#each THREAD_FILTERS as f (f)}
				<a
					href={href(data.selectedId, f)}
					aria-current={data.filter === f ? 'true' : undefined}
					class="inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm {data.filter === f
						? 'border-brand bg-brand/10 font-medium text-ink'
						: 'border-border text-ink-muted hover:text-ink'}"
				>
					{FILTER_LABEL[f]}<span class="tabular-nums text-xs">{counts[f]}</span>
				</a>
			{/each}
		</nav>
		<div class="ml-auto w-full sm:w-64">
			<Input type="search" bind:value={query} placeholder="Search guest, phone or code" aria-label="Search conversations" class="h-9" />
		</div>
	</div>

	{#if data.threads.length === 0}
		<div class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-12 text-center">
			<MessageSquareIcon class="size-6 text-ink-muted" aria-hidden="true" />
			<p class="text-sm text-ink-muted">No messages yet. When a guest writes about an online order, it appears here.</p>
		</div>
	{:else}
		<div class="grid gap-4 lg:grid-cols-[22rem_1fr]">
			<!-- Conversations. On a phone the list gives way to the open conversation. -->
			<section aria-label="Conversations" class="{selected ? 'hidden lg:block' : ''} min-w-0">
				{#if visible.length === 0}
					<p class="rounded-xl border border-dashed border-border p-6 text-center text-sm text-ink-muted">Nothing matches.</p>
				{:else}
					<ul class="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
						{#each visible as t (t.orderId)}
							<li>
								<a
									href={href(t.orderId)}
									aria-current={t.orderId === data.selectedId ? 'true' : undefined}
									class="block px-4 py-3 hover:bg-surface-2/60 {t.orderId === data.selectedId ? 'bg-brand/5' : ''}"
								>
									<span class="flex items-start justify-between gap-2">
										<span class="min-w-0 truncate text-sm {t.unread > 0 ? 'font-semibold' : 'font-medium'} text-ink">{t.guestName ?? 'Guest'}</span>
										<span class="shrink-0 text-xs tabular-nums text-ink-muted">{relativeTime(t.lastAt, nowMs, data.timezone)}</span>
									</span>
									<span class="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
										<span class="rounded px-1.5 py-0.5 font-semibold {kindClass(t.kind)}">{THREAD_KIND_LABEL[t.kind]}</span>
										<span class="font-mono text-ink-muted">{t.code}</span>
										{#if t.reservation}<span class="font-mono text-ink-muted">{t.reservation.code}</span>{/if}
									</span>
									<span class="mt-1 flex items-center gap-2">
										<span class="min-w-0 flex-1 truncate text-sm {t.unread > 0 ? 'text-ink' : 'text-ink-muted'}">
											{t.lastFrom === 'staff' ? 'You: ' : ''}{t.lastBody}
										</span>
										{#if t.unread > 0}
											<span class="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold tabular-nums text-brand-ink" aria-label="{t.unread} unread">{t.unread}</span>
										{/if}
									</span>
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<!-- The open conversation -->
			<section aria-label="Conversation" class="{selected ? '' : 'hidden lg:block'} min-w-0">
				{#if !selected || !data.detail}
					<div class="flex h-full min-h-64 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-8 text-center">
						<MessageSquareIcon class="size-6 text-ink-muted" aria-hidden="true" />
						<p class="text-sm text-ink-muted">Choose a conversation to read and reply.</p>
					</div>
				{:else}
					{@const t = selected}
					<div class="overflow-hidden rounded-xl border border-border bg-surface">
						<div class="border-b border-border px-5 py-4">
							<a href={href(null)} class="mb-2 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink lg:hidden">
								<ArrowLeftIcon class="size-4" aria-hidden="true" /> All messages
							</a>
							<div class="flex flex-wrap items-center gap-2">
								<h2 class="text-base font-semibold text-ink">{t.guestName ?? 'Guest'}</h2>
								<span class="rounded px-1.5 py-0.5 text-xs font-semibold {kindClass(t.kind)}">{THREAD_KIND_LABEL[t.kind]}</span>
							</div>
							{#if t.guestPhone}
								<a href="tel:{t.guestPhone}" class="mt-1 inline-flex items-center gap-1 text-sm text-ink-muted underline-offset-2 hover:underline">
									<PhoneIcon class="size-3.5" aria-hidden="true" />{t.guestPhone}
								</a>
							{/if}

							<!-- What this conversation is about -->
							<dl class="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
								<div class="flex justify-between gap-3"><dt class="text-ink-muted">Order</dt><dd class="font-mono">{t.code}</dd></div>
								<div class="flex justify-between gap-3"><dt class="text-ink-muted">Venue</dt><dd>{t.venueTitle}</dd></div>
								{#if t.kind === 'pickup'}
									<div class="flex justify-between gap-3"><dt class="text-ink-muted">Pickup</dt><dd>{t.pickupAt ? slot(t.pickupAt) : 'No time set'}</dd></div>
								{:else if t.kind === 'delivery'}
									<div class="flex justify-between gap-3"><dt class="text-ink-muted">Delivery</dt><dd>{t.pickupAt ? slot(t.pickupAt) : 'No time set'}</dd></div>
									<div class="flex justify-between gap-3 sm:col-span-2"><dt class="shrink-0 text-ink-muted">Deliver to</dt><dd class="text-right">{t.deliveryAddress ?? '—'}</dd></div>
									{#if t.riderName}
										<div class="flex justify-between gap-3"><dt class="text-ink-muted">Rider</dt><dd>{t.riderName}{t.outForDeliveryAt ? ' (out for delivery)' : ''}</dd></div>
									{/if}
								{:else if t.kind === 'reservation' && t.reservation}
									<div class="flex justify-between gap-3"><dt class="text-ink-muted">Reservation</dt><dd class="font-mono">{t.reservation.code}</dd></div>
									<div class="flex justify-between gap-3"><dt class="text-ink-muted">Table time</dt><dd>{slot(t.reservation.startsAt)}</dd></div>
									<div class="flex justify-between gap-3"><dt class="text-ink-muted">Party</dt><dd>{t.reservation.partySize} {t.reservation.partySize === 1 ? 'guest' : 'guests'}</dd></div>
									<div class="flex justify-between gap-3"><dt class="text-ink-muted">Reservation status</dt><dd class="capitalize">{t.reservation.status.replace('_', ' ')}</dd></div>
									{#if t.tableLabel}<div class="flex justify-between gap-3"><dt class="text-ink-muted">Table</dt><dd>{t.tableLabel}</dd></div>{/if}
								{:else if t.tableLabel}
									<div class="flex justify-between gap-3"><dt class="text-ink-muted">Table</dt><dd>{t.tableLabel}</dd></div>
								{/if}
								<div class="flex justify-between gap-3"><dt class="text-ink-muted">Order status</dt><dd>{statusLabel(t.status)}</dd></div>
								<div class="flex justify-between gap-3"><dt class="text-ink-muted">Payment</dt><dd>{payLabel(t.paymentStatus)} · {peso(t.totalCentavos)}</dd></div>
							</dl>
							{#if data.detail.items.length > 0}
								<p class="mt-3 text-sm text-ink-muted">
									{data.detail.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
								</p>
							{/if}
							<p class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
								<a href="{base}/orders" class="text-brand underline underline-offset-2">Open Orders</a>
								{#if t.kind === 'reservation'}<a href="{base}/reservations" class="text-brand underline underline-offset-2">Open Reservations</a>{/if}
							</p>
						</div>

						<div class="max-h-[50vh] min-h-48 space-y-3 overflow-y-auto px-5 py-4" aria-live="polite">
							{#each data.detail.messages as m (m.id)}
								<div class="flex {m.direction === 'staff' ? 'justify-end' : 'justify-start'}">
									<div class="max-w-[85%] rounded-lg px-3 py-2 text-sm {m.direction === 'staff' ? 'bg-brand/10 text-ink' : 'bg-surface-2 text-ink'}">
										<p class="whitespace-pre-line">{m.body}</p>
										<p class="mt-1 text-[11px] text-ink-muted">{m.direction === 'staff' ? 'You' : (t.guestName ?? 'Guest')} · {stamp(m.createdAt)}</p>
									</div>
								</div>
							{/each}
						</div>

						{#if data.canWrite}
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
								<input type="hidden" name="orderId" value={t.orderId} />
								<Textarea name="body" bind:value={draft} rows={2} maxlength={1000} placeholder="Reply to {t.guestName ?? 'the guest'}" aria-label="Reply to the guest" class="min-h-0" />
								<div class="flex items-center justify-between gap-3">
									<p class="text-xs text-ink-muted">Replies appear on the guest's order page.</p>
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
