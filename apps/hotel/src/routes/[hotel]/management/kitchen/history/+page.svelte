<script lang="ts">
	import { goto } from '$app/navigation';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import StatBar from '$lib/components/stat-bar.svelte';
	import ChefHatIcon from '@lucide/svelte/icons/chef-hat';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import UtensilsIcon from '@lucide/svelte/icons/utensils';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const h = $derived(data.history);
	const RANGE_LABEL = { today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days' } as const;

	const peak = $derived(Math.max(1, ...h.byHour.map((b) => b.tickets)));
	// Show only the hours the kitchen was actually working, padded by one hour each side.
	const active = $derived(h.byHour.filter((b) => b.tickets > 0).map((b) => b.hour));
	const hours = $derived(
		active.length === 0
			? []
			: h.byHour.filter((b) => b.hour >= Math.max(0, Math.min(...active) - 1) && b.hour <= Math.min(23, Math.max(...active) + 1))
	);
	const hourLabel = (n: number) => `${((n + 11) % 12) + 1}${n < 12 ? 'am' : 'pm'}`;
	const cookName = (id: string | null) => (id ? (h.cookNames[id] ?? 'Former staff') : 'Not recorded');
	const topMax = $derived(Math.max(1, ...h.topDishes.map((d) => d.quantity)));
</script>

<svelte:head><title>History · Kitchen</title></svelte:head>

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div class="max-w-xl">
			<h2 class="text-base font-semibold text-ink">History</h2>
			<p class="mt-1 text-sm text-ink-muted">
				A ticket is one station's part of an order, timed from when the order was placed until its last
				dish was marked ready. It is late once that reaches 20 minutes.
			</p>
		</div>
		<ToggleGroup.Root
			type="single"
			variant="outline"
			value={data.range}
			onValueChange={(v) => v && goto(`?range=${v}`, { noScroll: true, keepFocus: true })}
			aria-label="Period"
		>
			{#each Object.entries(RANGE_LABEL) as [value, label] (value)}
				<ToggleGroup.Item {value} class="h-10 px-4">{label}</ToggleGroup.Item>
			{/each}
		</ToggleGroup.Root>
	</div>

	{#if h.tickets === 0}
		<p class="mt-8 rounded-lg border border-dashed border-border px-4 py-12 text-center text-sm text-ink-muted">
			No finished tickets for {RANGE_LABEL[data.range].toLowerCase()} yet.
		</p>
	{:else}
		<StatBar
			stats={[
				{ icon: ChefHatIcon, value: String(h.tickets), label: 'Tickets done' },
				{ icon: UtensilsIcon, value: String(h.portions), label: 'Portions' },
				{ icon: ClockIcon, value: `${h.avgMinutes} min`, label: 'Average ticket time' },
				{ icon: TriangleAlertIcon, value: `${h.latePct}%`, label: `Late (${h.late} of ${h.tickets})` }
			]}
		/>

		<section class="mt-8" aria-labelledby="by-station">
			<h3 id="by-station" class="text-sm font-semibold text-ink">By station</h3>
			<div class="mt-2 overflow-x-auto rounded-lg border border-border">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Station</Table.Head>
							<Table.Head class="text-right">Tickets</Table.Head>
							<Table.Head class="text-right">Average</Table.Head>
							<Table.Head class="text-right">Slowest 10%</Table.Head>
							<Table.Head class="text-right">Late</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each h.stations as s (s.key)}
							<Table.Row>
								<Table.Cell class="font-medium">{s.label}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{s.tickets}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{s.avgMinutes} min</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{s.p90Minutes} min</Table.Cell>
								<Table.Cell class="text-right tabular-nums {s.latePct >= 25 ? 'font-semibold text-danger' : ''}">
									{#if s.latePct >= 25}<TriangleAlertIcon class="mr-1 inline size-3.5" aria-hidden="true" />{/if}{s.late} ({s.latePct}%)
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		</section>

		<div class="mt-8 grid gap-8 lg:grid-cols-2">
			<section aria-labelledby="by-hour">
				<h3 id="by-hour" class="text-sm font-semibold text-ink">Busiest hours</h3>
				<p class="text-xs text-ink-muted">Tickets finished per hour, on the hotel's clock.</p>
				<ol class="mt-3 space-y-1.5">
					{#each hours as b (b.hour)}
						<li class="flex items-center gap-3 text-sm">
							<span class="w-10 shrink-0 text-right tabular-nums text-ink-muted">{hourLabel(b.hour)}</span>
							<span class="h-4 flex-1 overflow-hidden rounded-sm bg-surface-2" role="presentation">
								<span class="block h-full rounded-sm bg-brand" style="width: {Math.round((b.tickets / peak) * 100)}%"></span>
							</span>
							<span class="w-8 shrink-0 tabular-nums">{b.tickets}</span>
						</li>
					{/each}
				</ol>
			</section>

			<section aria-labelledby="top-dishes">
				<h3 id="top-dishes" class="text-sm font-semibold text-ink">Most cooked dishes</h3>
				<ol class="mt-3 space-y-1.5">
					{#each h.topDishes as d (d.name)}
						<li class="flex items-center gap-3 text-sm">
							<span class="w-40 shrink-0 truncate sm:w-52">{d.name}</span>
							<span class="h-4 flex-1 overflow-hidden rounded-sm bg-surface-2" role="presentation">
								<span class="block h-full rounded-sm bg-brand" style="width: {Math.round((d.quantity / topMax) * 100)}%"></span>
							</span>
							<span class="w-8 shrink-0 tabular-nums">{d.quantity}</span>
						</li>
					{/each}
				</ol>
			</section>
		</div>

		<section class="mt-8 max-w-xl" aria-labelledby="by-cook">
			<h3 id="by-cook" class="text-sm font-semibold text-ink">By cook</h3>
			<p class="text-xs text-ink-muted">Tickets each person marked ready.</p>
			<ul class="mt-2 divide-y divide-border rounded-lg border border-border">
				{#each h.cooks as c (c.userId ?? 'none')}
					<li class="flex items-center justify-between px-4 py-2.5 text-sm">
						<span class={c.userId ? '' : 'text-ink-muted'}>{cookName(c.userId)}</span>
						<span class="tabular-nums">{c.tickets}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>
