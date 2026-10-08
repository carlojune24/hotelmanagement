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
	import ClockIcon from '@lucide/svelte/icons/clock';
	import CheckIcon from '@lucide/svelte/icons/check';
	import FlameIcon from '@lucide/svelte/icons/flame';
	import BedDoubleIcon from '@lucide/svelte/icons/bed-double';
	import {
		DEFAULT_TARGET_MINUTES,
		formatWait,
		groupByStation,
		waitLevel,
		type StationGroup,
		type WaitLevel
	} from '$lib/dining-orders';
	import { buildLanes, passList } from '$lib/dining-lanes';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	type Order = PageData['orders'][number];
	type Line = Order['items'][number];

	/** A ready plate that nobody has taken to the table for this long is going cold. */
	const COLD_MINUTES = 3;

	const full = $derived(page.url.searchParams.get('screen') === '1');
	// '' = every lane; '__none' = the lane of dishes with no station; otherwise a station name.
	const station = $derived(page.url.searchParams.get('station') ?? '');
	const view = $derived(page.url.searchParams.get('view') === 'tickets' ? 'tickets' : 'lanes');

	// ---- clock, polling and the "updated" indicator ------------------------------------
	let nowMs = $state(Date.now());
	let updatedAt = $state(Date.now());
	// Server time minus this device's clock at the last load, so waits stay right on a wall
	// screen whose clock has drifted.
	let skewMs = $state(0);
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
		skewMs = data.serverNow - Date.now();
		updatedAt = Date.now();
	});
	const ago = $derived(Math.max(0, Math.round((nowMs - updatedAt) / 1000)));
	const clockText = $derived(new Date(nowMs + skewMs).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }));
	const nowServer = $derived(nowMs + skewMs);

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
	const targetFor = (key: string) => data.stations.find((s) => s.name === key)?.targetMinutes ?? null;
	const targetOf = (key: string) => targetFor(key) ?? DEFAULT_TARGET_MINUTES;

	// ---- lanes: each station sees only the dishes it has to make ------------------------
	const allLanes = $derived(buildLanes(data.orders, data.stations));
	const laneKey = $derived(station === '__none' ? '' : station);
	const lanes = $derived(station ? allLanes.filter((l) => l.key === laneKey) : allLanes);
	const pass = $derived(passList(data.orders));
	// A chip per lane (and per station named on an order), with how many dishes are still to make.
	const chips = $derived(allLanes.map((l) => ({ value: l.key === '' ? '__none' : l.key, label: l.label, count: l.cards.length })));

	// ---- ticket view: one card per order, split by station inside ------------------------
	type Ticket = { order: Order; groups: StationGroup<Line>[]; shown: StationGroup<Line>[]; others: StationGroup<Line>[] };
	function toTicket(order: Order): Ticket | null {
		if (order.status === 'ready') return { order, groups: groupByStation(order.items), shown: [], others: [] };
		const groups = groupByStation(order.items);
		const shown = station ? groups.filter((g) => g.key === laneKey) : groups;
		if (shown.length === 0) return null;
		return { order, groups, shown, others: station ? groups.filter((g) => g.key !== laneKey) : [] };
	}
	const tickets = $derived(data.orders.map(toTicket).filter((t): t is Ticket => t !== null));
	// In a station view a ticket sits where that station is with it; its other stations don't matter.
	const colOf = (t: Ticket): 'new' | 'prep' | 'done' => {
		if (station) {
			const g = t.shown[0]!;
			return g.state === 'waiting' ? 'new' : g.state === 'cooking' ? 'prep' : 'done';
		}
		return t.order.status === 'preparing' ? 'prep' : 'new';
	};
	const live = $derived(tickets.filter((t) => t.order.status !== 'ready'));
	const columns = $derived([
		{ key: 'new', title: 'New', list: live.filter((t) => colOf(t) === 'new') },
		{ key: 'prep', title: 'Preparing', list: live.filter((t) => colOf(t) === 'prep') }
	]);

	const minutesSince = (d: Date | string | null) => (d ? Math.max(0, Math.floor((nowServer - new Date(d).getTime()) / 60_000)) : 0);
	const waited = (o: Order) => minutesSince(o.createdAt);
	const where = (o: Order) => (o.orderType === 'takeaway' ? 'Takeaway' : o.tableLabel ? `Table ${o.tableLabel}` : 'Dine-in');

	/** The worst a ticket is doing: each station still working is judged against its own target. */
	function ticketLevel(t: Ticket): WaitLevel {
		const m = waited(t.order);
		let worst: WaitLevel = 'ok';
		for (const g of t.shown) {
			if (g.state === 'ready') continue;
			const lvl = waitLevel(m, targetFor(g.key));
			if (lvl === 'late') return 'late';
			if (lvl === 'slow') worst = 'slow';
		}
		return worst;
	}

	const LEVEL_BORDER: Record<WaitLevel, string> = { ok: 'border-border', slow: 'border-warning/70', late: 'border-danger' };
	const LEVEL_TEXT: Record<WaitLevel, string> = { ok: '', slow: 'text-warning', late: 'text-danger' };

	async function move(order: Order, to: 'preparing' | 'ready', key: string) {
		if (busy) return;
		busy = `${order.id}:${key}`;
		error = '';
		const body = new FormData();
		body.set('orderId', order.id);
		body.set('to', to);
		body.set('station', key === '' ? '__none' : key);
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
	<div class="mx-auto flex min-h-full w-full max-w-[1800px] flex-col gap-4 px-4 py-4 sm:px-6">
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

			{#if chips.length > 1}
				<ToggleGroup.Root
					type="single"
					variant="outline"
					value={station || 'all'}
					onValueChange={(v) => v && setParam('station', v === 'all' ? '' : v)}
					aria-label="Station"
				>
					<ToggleGroup.Item value="all" class="h-11 px-4">All stations</ToggleGroup.Item>
					{#each chips as c (c.value)}
						<ToggleGroup.Item value={c.value} class="h-11 gap-2 px-4">
							{c.label}
							<span class="text-xs tabular-nums text-ink-muted">{c.count}</span>
						</ToggleGroup.Item>
					{/each}
				</ToggleGroup.Root>
			{/if}

			<ToggleGroup.Root
				type="single"
				variant="outline"
				value={view}
				onValueChange={(v) => v && setParam('view', v === 'lanes' ? '' : v)}
				aria-label="Board layout"
			>
				<ToggleGroup.Item value="lanes" class="h-11 px-4">By station</ToggleGroup.Item>
				<ToggleGroup.Item value="tickets" class="h-11 px-4">Whole tickets</ToggleGroup.Item>
			</ToggleGroup.Root>

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

		{#if view === 'lanes'}
			<!-- One lane per station: a cook watches their own lane and nobody else's dishes. -->
			<div class="grid flex-1 auto-cols-[minmax(19rem,1fr)] grid-flow-col gap-4 overflow-x-auto pb-1">
				{#each lanes as lane (lane.key)}
					<section aria-labelledby="lane-{lane.key || 'none'}" class="flex min-w-0 flex-col gap-3">
						<div class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b-2 border-border pb-2">
							<h3 id="lane-{lane.key || 'none'}" class="text-xl font-semibold tracking-tight">{lane.label}</h3>
							<p class="text-sm tabular-nums text-ink-muted">
								{lane.waiting} to start · {lane.cooking} cooking
							</p>
							<p class="ml-auto text-xs text-ink-muted">late after {targetOf(lane.key)} min</p>
						</div>

						{#each lane.cards as card (card.order.id)}
							{@const m = waited(card.order)}
							{@const level = waitLevel(m, lane.targetMinutes)}
							<article class="rounded-xl border-2 bg-surface p-4 {LEVEL_BORDER[level]}">
								<div class="flex items-start justify-between gap-3">
									<div class="min-w-0">
										<p class="font-mono text-2xl font-bold">{card.order.code}</p>
										<p class="mt-0.5 truncate text-base text-ink-muted">
											{where(card.order)}{card.order.guestName ? ` · ${card.order.guestName}` : ''}
										</p>
										{#if card.order.bookingCode}
											<p class="mt-0.5 flex items-center gap-1 text-sm text-ink-muted">
												<BedDoubleIcon class="size-3.5" aria-hidden="true" />
												{#if card.order.roomLabel}Room {card.order.roomLabel}{:else}In-house{/if}
											</p>
										{/if}
									</div>
									<div class="shrink-0 text-right">
										<p class="text-xs uppercase tracking-wide text-ink-muted">Waiting</p>
										<p class="font-mono text-3xl leading-none font-bold tabular-nums {LEVEL_TEXT[level]}">{formatWait(m)}</p>
										{#if level === 'late'}
											<p class="mt-1 flex items-center justify-end gap-1 text-sm font-semibold text-danger">
												<TriangleAlertIcon class="size-3.5" aria-hidden="true" />Late
											</p>
										{:else if level === 'slow'}
											<p class="mt-1 flex items-center justify-end gap-1 text-sm font-semibold text-warning">
												<ClockIcon class="size-3.5" aria-hidden="true" />Slow
											</p>
										{/if}
										{#if card.order.source === 'qr'}<Badge variant="outline" class="mt-1">QR</Badge>{/if}
										{#if card.order.source === 'online'}<Badge variant="outline" class="mt-1">Online</Badge>{/if}
									</div>
								</div>

								<p class="mt-3 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide {card.state === 'cooking' ? LEVEL_TEXT[level] || 'text-ink' : 'text-ink-muted'}">
									{#if card.state === 'cooking'}
										<FlameIcon class="size-4" aria-hidden="true" />
										Cooking {card.group.startedAt ? formatWait(minutesSince(card.group.startedAt)) : ''}
									{:else}
										Not started
									{/if}
								</p>
								<ul class="mt-1 divide-y divide-border border-y border-border">
									{#each card.group.items as it (it.id)}
										<li class="py-2">
											<p class="text-[22px] leading-snug"><span class="mr-2 font-bold tabular-nums">{it.quantity}×</span>{it.name}</p>
											{#each it.addons as a (a)}<p class="pl-9 text-lg text-ink-muted">+ {a}</p>{/each}
											{#if it.remarks}<p class="pl-9 text-lg font-semibold">“{it.remarks}”</p>{/if}
										</li>
									{/each}
								</ul>

								<div class="mt-2 flex items-center gap-2">
									<div class="h-1.5 flex-1 overflow-hidden rounded-full bg-border" role="presentation">
										<div
											class="h-full rounded-full {level === 'late' ? 'bg-danger' : level === 'slow' ? 'bg-warning' : 'bg-brand'}"
											style="width: {Math.min(100, Math.round((m / targetOf(lane.key)) * 100))}%"
										></div>
									</div>
									<span class="text-xs tabular-nums text-ink-muted">of {targetOf(lane.key)} min</span>
								</div>

								{#if card.elsewhere.length > 0}
									<p class="mt-2 text-sm text-ink-muted">
										Also on this order:
										{#each card.elsewhere as g, i (g.key)}
											{i > 0 ? ' · ' : ' '}{g.label}
											{g.state === 'ready' ? '✓ ready' : g.state === 'cooking' ? 'cooking' : 'not started'}
										{/each}
									</p>
								{/if}
								{#if card.order.remarks}<p class="mt-2 text-lg font-semibold">Note: “{card.order.remarks}”</p>{/if}

								{#if data.canMove}
									<Button
										class="mt-3 h-14 w-full text-lg"
										onclick={() => move(card.order, card.state === 'waiting' ? 'preparing' : 'ready', lane.key)}
										disabled={busy !== null}
									>
										{#if busy === `${card.order.id}:${lane.key}`}
											Saving…
										{:else if card.state === 'waiting'}
											Start
										{:else}
											Ready
										{/if}
									</Button>
								{/if}
							</article>
						{:else}
							<p class="rounded-xl border border-dashed border-border px-4 py-10 text-center text-base text-ink-muted">
								Nothing to make at {lane.label}.
							</p>
						{/each}
					</section>
				{/each}
			</div>
		{:else}
			<!-- Whole tickets: one card per order, split by station inside. -->
			<div class="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
				{#each columns as col (col.key)}
					<section aria-labelledby="col-{col.key}" class="flex min-w-0 flex-col gap-3">
						<div class="flex items-baseline gap-2 border-b border-border pb-2">
							<h3 id="col-{col.key}" class="text-base font-semibold uppercase tracking-wide">{col.title}</h3>
							<span class="text-base tabular-nums text-ink-muted">{col.list.length}</span>
							<span class="ml-auto text-xs text-ink-muted">Oldest first</span>
						</div>
						{#each col.list as t (t.order.id)}
							{@const m = waited(t.order)}
							{@const level = ticketLevel(t)}
							{@const multi = t.shown.length > 1}
							<article class="rounded-xl border-2 bg-surface p-4 {LEVEL_BORDER[level]}">
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
										<p class="text-xs uppercase tracking-wide text-ink-muted">Waiting</p>
										<p class="font-mono text-3xl leading-none font-bold tabular-nums {LEVEL_TEXT[level]}">{formatWait(m)}</p>
										{#if level === 'late'}
											<p class="mt-1 flex items-center justify-end gap-1 text-sm font-semibold text-danger">
												<TriangleAlertIcon class="size-3.5" aria-hidden="true" />Late
											</p>
										{:else if level === 'slow'}
											<p class="mt-1 flex items-center justify-end gap-1 text-sm font-semibold text-warning">
												<ClockIcon class="size-3.5" aria-hidden="true" />Slow
											</p>
										{/if}
										{#if t.order.source === 'online'}<Badge variant="outline" class="mt-1">Online</Badge>{/if}
										{#if t.order.source === 'qr'}<Badge variant="outline" class="mt-1">QR</Badge>{/if}
									</div>
								</div>

								{#each t.shown as g (g.key)}
									{@const gLevel = g.state === 'ready' ? 'ok' : waitLevel(m, targetFor(g.key))}
									<div class="mt-3 {multi ? 'rounded-lg border border-border bg-surface-2/40 p-3' : ''}">
										{#if multi}
											<div class="mb-1 flex items-center justify-between gap-2">
												<p class="flex items-center gap-1.5 text-base font-semibold uppercase tracking-wide">
													{#if g.state === 'ready'}
														<CheckIcon class="size-4 text-brand" aria-hidden="true" />
													{:else if g.state === 'cooking'}
														<FlameIcon class="size-4 {LEVEL_TEXT[gLevel]}" aria-hidden="true" />
													{/if}
													{g.label}
												</p>
												<p class="text-sm tabular-nums {g.state === 'ready' ? 'text-brand' : LEVEL_TEXT[gLevel] || 'text-ink-muted'}">
													{#if g.state === 'ready'}
														Ready · {g.readyAt ? `${formatWait(minutesSince(g.readyAt))} ago` : ''}
													{:else if g.state === 'cooking'}
														Cooking {g.startedAt ? formatWait(minutesSince(g.startedAt)) : ''}
													{:else}
														Not started
													{/if}
												</p>
											</div>
										{/if}
										<ul class="divide-y divide-border {multi ? '' : 'border-y border-border'}">
											{#each g.items as it (it.id)}
												<li class="py-2">
													<p class="text-[22px] leading-snug {it.readyAt && multi ? 'text-ink-muted line-through decoration-1' : ''}">
														<span class="mr-2 font-bold tabular-nums">{it.quantity}×</span>{it.name}
													</p>
													{#each it.addons as a (a)}<p class="pl-9 text-lg text-ink-muted">+ {a}</p>{/each}
													{#if it.remarks}<p class="pl-9 text-lg font-semibold">“{it.remarks}”</p>{/if}
												</li>
											{/each}
										</ul>
										{#if g.state !== 'ready'}
											<div class="mt-2 flex items-center gap-2">
												<div class="h-1.5 flex-1 overflow-hidden rounded-full bg-border" role="presentation">
													<div
														class="h-full rounded-full {gLevel === 'late' ? 'bg-danger' : gLevel === 'slow' ? 'bg-warning' : 'bg-brand'}"
														style="width: {Math.min(100, Math.round((m / targetOf(g.key)) * 100))}%"
													></div>
												</div>
												<span class="text-xs tabular-nums text-ink-muted">of {targetOf(g.key)} min</span>
											</div>
										{/if}
										{#if data.canMove && g.state !== 'ready'}
											<Button
												class="mt-3 h-14 w-full text-lg"
												onclick={() => move(t.order, g.state === 'waiting' ? 'preparing' : 'ready', g.key)}
												disabled={busy !== null}
											>
												{#if busy === `${t.order.id}:${g.key}`}
													Saving…
												{:else if g.state === 'waiting'}
													Start{multi ? ` ${g.label}` : ''}
												{:else}
													{multi ? `${g.label} ready` : 'Ready'}
												{/if}
											</Button>
										{/if}
									</div>
								{/each}

								{#if t.others.length > 0}
									<p class="mt-3 text-sm text-ink-muted">
										Elsewhere:
										{#each t.others as o, i (o.key)}
											{i > 0 ? ' · ' : ' '}{o.label}
											{o.state === 'ready' ? '✓ ready' : o.state === 'cooking' ? 'cooking' : 'not started'}
										{/each}
									</p>
								{/if}
								{#if t.order.remarks}<p class="mt-2 text-lg font-semibold">Note: “{t.order.remarks}”</p>{/if}
							</article>
						{:else}
							<p class="rounded-xl border border-dashed border-border px-4 py-10 text-center text-base text-ink-muted">
								{col.key === 'new' ? 'No new tickets.' : 'Nothing on the stove.'}
							</p>
						{/each}
					</section>
				{/each}
			</div>
		{/if}

		<section aria-labelledby="col-ready" class="border-t border-border pt-3">
			<div class="flex items-baseline gap-2">
				<h3 id="col-ready" class="text-base font-semibold uppercase tracking-wide">Ready for the table</h3>
				<span class="text-base tabular-nums text-ink-muted">{pass.length}</span>
				<span class="ml-auto text-xs text-ink-muted">Every station is done. The floor serves it.</span>
			</div>
			<div class="mt-2 flex flex-wrap gap-2">
				{#each pass as o (o.id)}
					{@const waitingMin = minutesSince(o.readyAt)}
					{@const cold = waitingMin >= COLD_MINUTES}
					<span class="rounded-lg border-2 px-3 py-2 text-base {cold ? 'border-warning/70 bg-warning/10' : 'border-border bg-surface-2'}">
						<span class="font-mono font-bold">{o.code}</span>
						<span class="text-ink-muted"> · {where(o)}</span>
						<span class="ml-1 inline-flex items-center gap-1 text-sm tabular-nums {cold ? 'font-semibold text-warning' : 'text-ink-muted'}">
							{#if cold}<ClockIcon class="size-3.5" aria-hidden="true" />{/if}
							ready {formatWait(waitingMin)} ago{cold ? ' · getting cold' : ''}
						</span>
					</span>
				{:else}
					<span class="text-base text-ink-muted">Nothing waiting.</span>
				{/each}
			</div>
		</section>
	</div>
</div>
