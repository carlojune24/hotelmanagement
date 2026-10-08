<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import { deserialize } from '$app/forms';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import MaximizeIcon from '@lucide/svelte/icons/maximize-2';
	import MinimizeIcon from '@lucide/svelte/icons/minimize-2';
	import Volume2Icon from '@lucide/svelte/icons/volume-2';
	import VolumeXIcon from '@lucide/svelte/icons/volume-x';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import BedDoubleIcon from '@lucide/svelte/icons/bed-double';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	type Order = PageData['orders'][number];

	const WARN_MINUTES = 10;
	const LATE_MINUTES = 20;

	const full = $derived(page.url.searchParams.get('screen') === '1');
	const station = $derived(page.url.searchParams.get('station') ?? '');

	// ---- clock, polling and the "updated" indicator ------------------------------------
	let nowMs = $state(Date.now());
	let updatedAt = $state(Date.now());
	let sound = $state(false);
	let busy = $state<string | null>(null);
	let error = $state('');

	$effect(() => {
		try {
			sound = localStorage.getItem('kitchen-sound') === '1';
		} catch {
			/* storage blocked: sound stays off */
		}
	});
	$effect(() => {
		const clock = setInterval(() => (nowMs = Date.now()), 1000);
		const refresh = setInterval(() => {
			if (!document.hidden) invalidate('app:dining-kitchen');
		}, 10_000);
		return () => {
			clearInterval(clock);
			clearInterval(refresh);
		};
	});
	$effect(() => {
		void data.serverNow;
		updatedAt = Date.now();
	});
	const ago = $derived(Math.max(0, Math.round((nowMs - updatedAt) / 1000)));
	const clockText = $derived(new Date(nowMs).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }));

	// ---- a soft chime when a new ticket arrives (browsers need one tap first, hence the toggle) --
	let seen: Set<string> | null = null;
	function chime() {
		try {
			const ctx = new AudioContext();
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.frequency.value = 880;
			gain.gain.setValueAtTime(0.15, ctx.currentTime);
			gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
			osc.connect(gain).connect(ctx.destination);
			osc.start();
			osc.stop(ctx.currentTime + 0.5);
		} catch {
			/* no audio available */
		}
	}
	$effect(() => {
		const ids = new Set(data.orders.filter((o) => o.status === 'new' || o.status === 'accepted').map((o) => o.id));
		if (seen && sound && [...ids].some((id) => !seen!.has(id))) chime();
		seen = ids;
	});
	function toggleSound() {
		sound = !sound;
		try {
			localStorage.setItem('kitchen-sound', sound ? '1' : '0');
		} catch {
			/* ignore */
		}
		if (sound) chime();
	}

	// ---- filters ----------------------------------------------------------------------
	function setParam(key: string, value: string) {
		const q = new URLSearchParams(page.url.searchParams);
		if (value) q.set(key, value);
		else q.delete(key);
		goto(`?${q}`, { keepFocus: true, noScroll: true, replaceState: true });
	}
	const stationNames = $derived([
		...new Set([...data.stations, ...data.orders.flatMap((o) => o.items.map((i) => i.stationName ?? '').filter(Boolean))])
	]);
	const stationCount = (name: string) =>
		data.orders.filter((o) => o.status !== 'ready' && o.items.some((i) => i.stationName === name)).length;

	type Ticket = { order: Order; mine: Order['items']; others: number };
	function toTicket(order: Order): Ticket | null {
		if (!station) return { order, mine: order.items, others: 0 };
		const mine = order.items.filter((i) => i.stationName === station);
		if (mine.length === 0) return null;
		return { order, mine, others: order.items.length - mine.length };
	}
	const tickets = $derived(data.orders.map(toTicket).filter((t): t is Ticket => t !== null));
	const fresh = $derived(tickets.filter((t) => t.order.status === 'new' || t.order.status === 'accepted'));
	const cooking = $derived(tickets.filter((t) => t.order.status === 'preparing'));
	const ready = $derived(tickets.filter((t) => t.order.status === 'ready'));
	const columns = $derived([
		{ key: 'new', title: 'New', list: fresh, to: 'preparing' as const, cta: 'Start' },
		{ key: 'prep', title: 'Preparing', list: cooking, to: 'ready' as const, cta: 'Ready' }
	]);

	const minutes = (o: Order) => Math.max(0, Math.floor((nowMs - new Date(o.createdAt).getTime()) / 60_000));
	const where = (o: Order) => (o.orderType === 'takeaway' ? 'Takeaway' : o.tableLabel ? `Table ${o.tableLabel}` : 'Dine-in');

	async function move(order: Order, to: 'preparing' | 'ready') {
		if (busy) return;
		busy = order.id;
		error = '';
		const body = new FormData();
		body.set('orderId', order.id);
		body.set('to', to);
		try {
			const res = await fetch('?/advance', { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
			const result = deserialize(await res.text());
			if (result.type === 'failure') error = String(result.data?.error ?? 'That could not be done.');
			else if (result.type === 'error') error = 'Something went wrong. Try again.';
		} catch {
			error = 'No connection. Try again.';
		} finally {
			busy = null;
			await invalidate('app:dining-kitchen');
		}
	}

	async function toggleFull() {
		if (full) {
			if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
			setParam('screen', '');
		} else {
			setParam('screen', '1');
			await document.documentElement.requestFullscreen?.().catch(() => {});
		}
	}
</script>

<svelte:head><title>Kitchen · Dining</title></svelte:head>

<!-- Dark, high-contrast board. In full-screen mode it covers the staff shell. -->
<div class="dark bg-background text-ink {full ? 'fixed inset-0 z-50 overflow-y-auto' : 'min-h-[calc(100vh-9rem)]'}">
	<div class="mx-auto flex min-h-full w-full max-w-[1600px] flex-col gap-4 px-4 py-4 sm:px-6">
		<header class="flex flex-wrap items-center gap-x-4 gap-y-3">
			<h2 class="text-lg font-semibold tracking-tight">Kitchen</h2>

			{#if data.venues.length > 1}
				<ToggleGroup.Root
					type="single"
					variant="outline"
					value={data.venueId ?? 'all'}
					onValueChange={(v) => v && setParam('venue', v === 'all' ? '' : v)}
					aria-label="Venue"
				>
					<ToggleGroup.Item value="all" class="h-11 px-4">All venues</ToggleGroup.Item>
					{#each data.venues as v (v.id)}
						<ToggleGroup.Item value={v.id} class="h-11 px-4">{v.title}</ToggleGroup.Item>
					{/each}
				</ToggleGroup.Root>
			{/if}

			{#if stationNames.length > 0}
				<ToggleGroup.Root
					type="single"
					variant="outline"
					value={station || 'all'}
					onValueChange={(v) => v && setParam('station', v === 'all' ? '' : v)}
					aria-label="Station"
				>
					<ToggleGroup.Item value="all" class="h-11 px-4">All</ToggleGroup.Item>
					{#each stationNames as s (s)}
						<ToggleGroup.Item value={s} class="h-11 gap-2 px-4">
							{s}
							<span class="text-xs tabular-nums text-ink-muted">{stationCount(s)}</span>
						</ToggleGroup.Item>
					{/each}
				</ToggleGroup.Root>
			{/if}

			<div class="ml-auto flex items-center gap-3">
				<span class="text-xs tabular-nums text-ink-muted">Updated {ago < 3 ? 'just now' : `${ago}s ago`}</span>
				<span class="text-2xl font-semibold tabular-nums">{clockText}</span>
				<Button
					variant="outline"
					size="icon"
					class="size-11"
					onclick={toggleSound}
					aria-pressed={sound}
					aria-label={sound ? 'Turn sound off' : 'Turn sound on'}
					title={sound ? 'Sound on' : 'Sound off'}
				>
					{#if sound}<Volume2Icon class="size-5" />{:else}<VolumeXIcon class="size-5" />{/if}
				</Button>
				<Button
					variant="outline"
					size="icon"
					class="size-11"
					onclick={toggleFull}
					aria-label={full ? 'Leave full screen' : 'Open full screen'}
					title={full ? 'Leave full screen' : 'Open full screen'}
				>
					{#if full}<MinimizeIcon class="size-5" />{:else}<MaximizeIcon class="size-5" />{/if}
				</Button>
			</div>
		</header>

		{#if data.cancelled.length > 0}
			<div class="flex items-start gap-3 rounded-lg border border-danger/50 bg-danger/10 px-4 py-3" role="alert">
				<TriangleAlertIcon class="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
				<p class="text-base">
					<strong>Stop cooking:</strong>
					{data.cancelled.map((c) => `${c.code}${c.tableLabel ? ` (table ${c.tableLabel})` : ''}`).join(', ')}
					{data.cancelled.length === 1 ? 'was' : 'were'} cancelled.
				</p>
			</div>
		{/if}
		{#if error}
			<p class="rounded-lg border border-danger/50 bg-danger/10 px-4 py-3 text-base" role="alert">{error}</p>
		{/if}

		<div class="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
			{#each columns as col (col.key)}
				<section aria-labelledby="col-{col.key}" class="flex min-w-0 flex-col gap-3">
					<div class="flex items-baseline gap-2 border-b border-border pb-2">
						<h3 id="col-{col.key}" class="text-base font-semibold uppercase tracking-wide">{col.title}</h3>
						<span class="text-base tabular-nums text-ink-muted">{col.list.length}</span>
					</div>
					{#each col.list as t (t.order.id)}
						{@const m = minutes(t.order)}
						{@const isLate = m >= LATE_MINUTES}
						{@const isWarn = m >= WARN_MINUTES}
						<article class="rounded-xl border-2 bg-surface p-4 {isLate ? 'border-danger' : isWarn ? 'border-amber-400/70' : 'border-border'}">
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0">
									<p class="font-mono text-2xl font-bold">{t.order.code}</p>
									<p class="mt-0.5 truncate text-base text-ink-muted">
										{where(t.order)}{t.order.guestName ? ` · ${t.order.guestName}` : ''}
									</p>
									{#if t.order.bookingCode}
										<p class="mt-0.5 flex items-center gap-1 text-sm text-ink-muted">
											<BedDoubleIcon class="size-3.5" aria-hidden="true" />
											{#if t.order.roomLabel}Room {t.order.roomLabel}, {/if}booking <span class="font-mono">{t.order.bookingCode}</span>
										</p>
									{/if}
								</div>
								<div class="shrink-0 text-right">
									<p class="text-2xl font-bold tabular-nums {isLate ? 'text-danger' : isWarn ? 'text-amber-300' : ''}">{m} min</p>
									{#if isLate}
										<p class="flex items-center justify-end gap-1 text-sm font-semibold text-danger">
											<TriangleAlertIcon class="size-3.5" aria-hidden="true" />late
										</p>
									{/if}
									{#if t.order.source === 'online'}<Badge variant="outline" class="mt-1">Online</Badge>{/if}
								</div>
							</div>

							<ul class="mt-3 divide-y divide-border border-y border-border">
								{#each t.mine as it (it.id)}
									<li class="py-2">
										<p class="text-[22px] leading-snug"><span class="mr-2 font-bold tabular-nums">{it.quantity}×</span>{it.name}</p>
										{#each it.addons as a (a)}<p class="pl-9 text-lg text-ink-muted">+ {a}</p>{/each}
										{#if it.remarks}<p class="pl-9 text-lg font-semibold">“{it.remarks}”</p>{/if}
									</li>
								{/each}
							</ul>
							{#if t.others > 0}
								<p class="mt-2 text-sm text-ink-muted">+ {t.others} other {t.others === 1 ? 'item' : 'items'} on other stations</p>
							{/if}
							{#if t.order.remarks}<p class="mt-2 text-lg font-semibold">Note: “{t.order.remarks}”</p>{/if}

							{#if data.canMove}
								<Button class="mt-3 h-14 w-full text-lg" onclick={() => move(t.order, col.to)} disabled={busy !== null}>
									{busy === t.order.id ? 'Saving…' : col.cta}
								</Button>
							{/if}
						</article>
					{:else}
						<p class="rounded-xl border border-dashed border-border px-4 py-10 text-center text-base text-ink-muted">
							{col.key === 'new' ? 'No new tickets.' : 'Nothing on the stove.'}
						</p>
					{/each}
				</section>
			{/each}
		</div>

		<section aria-labelledby="col-ready" class="border-t border-border pt-3">
			<div class="flex items-baseline gap-2">
				<h3 id="col-ready" class="text-base font-semibold uppercase tracking-wide">Ready, waiting to be served</h3>
				<span class="text-base tabular-nums text-ink-muted">{ready.length}</span>
			</div>
			<div class="mt-2 flex flex-wrap gap-2">
				{#each ready as t (t.order.id)}
					<span class="rounded-lg border border-border bg-surface-2 px-3 py-2 text-base">
						<span class="font-mono font-bold">{t.order.code}</span>
						<span class="text-ink-muted"> · {where(t.order)}</span>
					</span>
				{:else}
					<span class="text-base text-ink-muted">Nothing waiting.</span>
				{/each}
			</div>
		</section>
	</div>
</div>
