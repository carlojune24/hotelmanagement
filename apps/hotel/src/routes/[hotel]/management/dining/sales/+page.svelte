<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import ChartNoAxesColumnIcon from '@lucide/svelte/icons/chart-no-axes-column';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const base = $derived(`/${page.params.hotel}/management/dining`);
	const peso = (c: number) =>
		`₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

	let from = $state('');
	let to = $state('');
	$effect(() => {
		from = data.from;
		to = data.to;
	});

	const r = $derived(data.report);
	const average = $derived(r.orders ? Math.round(r.grossCentavos / r.orders) : 0);
	const filterLabel = $derived(data.venues.find((v) => v.id === data.venueId)?.title ?? 'All venues');
	const METHOD: Record<string, string> = { cash: 'Cash', card: 'Card', gcash: 'GCash', maya: 'Maya', room_charge: 'Charged to room', unknown: 'Unknown' };

	const query = (range: { from: string; to: string }, venue = data.venueId) => {
		const q = new URLSearchParams({ from: range.from, to: range.to });
		if (venue) q.set('venue', venue);
		return q.toString();
	};
	const isActive = (range: { from: string; to: string }) => range.from === data.from && range.to === data.to;
	const PRESETS = [
		{ key: 'today', label: 'Today' },
		{ key: 'week', label: 'Last 7 days' },
		{ key: 'month', label: 'This month' }
	] as const;

	const fmtDay = (d: string) =>
		new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
</script>

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
	<div class="mb-5 flex flex-wrap items-end gap-3">
		<div class="flex gap-1.5" role="group" aria-label="Date range">
			{#each PRESETS as p (p.key)}
				<Button href="?{query(data.presets[p.key])}" variant={isActive(data.presets[p.key]) ? 'default' : 'outline'} size="sm">{p.label}</Button>
			{/each}
		</div>
		<form
			method="GET"
			class="flex items-end gap-2"
			onsubmit={(e) => {
				e.preventDefault();
				goto(`?${query({ from, to })}`, { keepFocus: true, noScroll: true });
			}}
		>
			<div>
				<Label for="salesFrom" class="text-xs">From</Label>
				<Input id="salesFrom" type="date" bind:value={from} max={data.today} class="mt-1 h-8 w-36" />
			</div>
			<div>
				<Label for="salesTo" class="text-xs">To</Label>
				<Input id="salesTo" type="date" bind:value={to} max={data.today} class="mt-1 h-8 w-36" />
			</div>
			<Button type="submit" variant="outline" size="sm" class="h-8">Apply</Button>
		</form>
		<div class="ml-auto flex items-center gap-2">
			{#if data.venues.length > 1}
				<Select.Root type="single" value={data.venueId ?? 'all'} onValueChange={(v) => goto(`?${query({ from: data.from, to: data.to }, v === 'all' ? null : v)}`, { noScroll: true })}>
					<Select.Trigger class="w-44" aria-label="Venue">{filterLabel}</Select.Trigger>
					<Select.Content>
						<Select.Item value="all" label="All venues" />
						{#each data.venues as v (v.id)}<Select.Item value={v.id} label={v.title} />{/each}
					</Select.Content>
				</Select.Root>
			{/if}
			<Button href="{base}/sales/csv?{query({ from: data.from, to: data.to })}" variant="outline" size="sm" download>
				<DownloadIcon class="size-4" /> CSV
			</Button>
		</div>
	</div>

	{#if r.orders === 0}
		<div class="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-12 text-center">
			<ChartNoAxesColumnIcon class="size-6 text-ink-muted" />
			<p class="text-sm text-ink-muted">No paid orders from {fmtDay(data.from)} to {fmtDay(data.to)}.</p>
			<p class="text-xs text-ink-muted">Only paid orders count. A voided payment is taken back out.</p>
		</div>
	{:else}
		<dl class="grid grid-cols-2 divide-border overflow-hidden rounded-xl border border-border bg-surface sm:grid-cols-4 sm:divide-x">
			<div class="px-4 py-3">
				<dt class="text-xs text-ink-muted">Orders paid</dt>
				<dd class="text-xl font-semibold tabular-nums text-ink">{r.orders}</dd>
			</div>
			<div class="px-4 py-3">
				<dt class="text-xs text-ink-muted">Sales, VAT included</dt>
				<dd class="text-xl font-semibold tabular-nums text-ink">{peso(r.grossCentavos)}</dd>
			</div>
			<div class="px-4 py-3">
				<dt class="text-xs text-ink-muted">VAT included</dt>
				<dd class="text-xl font-semibold tabular-nums text-ink">{peso(r.vatCentavos)}</dd>
			</div>
			<div class="px-4 py-3">
				<dt class="text-xs text-ink-muted">Average order</dt>
				<dd class="text-xl font-semibold tabular-nums text-ink">{peso(average)}</dd>
			</div>
		</dl>

		<div class="mt-6 grid gap-6 lg:grid-cols-2">
			<section aria-labelledby="byDay">
				<h2 id="byDay" class="mb-2 text-sm font-semibold text-ink">By day</h2>
				<div class="overflow-x-auto rounded-xl border border-border">
					<Table.Root>
						<Table.Header><Table.Row><Table.Head>Date</Table.Head><Table.Head class="text-right">Orders</Table.Head><Table.Head class="text-right">Sales</Table.Head></Table.Row></Table.Header>
						<Table.Body>
							{#each r.byDay as d (d.date)}
								<Table.Row><Table.Cell>{fmtDay(d.date)}</Table.Cell><Table.Cell class="text-right tabular-nums">{d.orders}</Table.Cell><Table.Cell class="text-right tabular-nums">{peso(d.grossCentavos)}</Table.Cell></Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			</section>

			<section aria-labelledby="byMethod">
				<h2 id="byMethod" class="mb-2 text-sm font-semibold text-ink">By payment method</h2>
				<div class="overflow-x-auto rounded-xl border border-border">
					<Table.Root>
						<Table.Header><Table.Row><Table.Head>Method</Table.Head><Table.Head class="text-right">Orders</Table.Head><Table.Head class="text-right">Sales</Table.Head></Table.Row></Table.Header>
						<Table.Body>
							{#each r.byMethod as m (m.method)}
								<Table.Row><Table.Cell>{METHOD[m.method] ?? m.method}</Table.Cell><Table.Cell class="text-right tabular-nums">{m.orders}</Table.Cell><Table.Cell class="text-right tabular-nums">{peso(m.grossCentavos)}</Table.Cell></Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			</section>

			{#if r.byVenue.length > 1}
				<section aria-labelledby="byVenue">
					<h2 id="byVenue" class="mb-2 text-sm font-semibold text-ink">By venue</h2>
					<div class="overflow-x-auto rounded-xl border border-border">
						<Table.Root>
							<Table.Header><Table.Row><Table.Head>Venue</Table.Head><Table.Head class="text-right">Orders</Table.Head><Table.Head class="text-right">Sales</Table.Head></Table.Row></Table.Header>
							<Table.Body>
								{#each r.byVenue as v (v.venueId)}
									<Table.Row><Table.Cell>{v.venue}</Table.Cell><Table.Cell class="text-right tabular-nums">{v.orders}</Table.Cell><Table.Cell class="text-right tabular-nums">{peso(v.grossCentavos)}</Table.Cell></Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</div>
				</section>
			{/if}

			<section aria-labelledby="byStation">
				<h2 id="byStation" class="mb-2 text-sm font-semibold text-ink">By station</h2>
				<div class="overflow-x-auto rounded-xl border border-border">
					<Table.Root>
						<Table.Header><Table.Row><Table.Head>Station</Table.Head><Table.Head class="text-right">Items</Table.Head><Table.Head class="text-right">Sales</Table.Head></Table.Row></Table.Header>
						<Table.Body>
							{#each r.byStation as st (st.station)}
								<Table.Row><Table.Cell>{st.station}</Table.Cell><Table.Cell class="text-right tabular-nums">{st.quantity}</Table.Cell><Table.Cell class="text-right tabular-nums">{peso(st.grossCentavos)}</Table.Cell></Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			</section>

			<section aria-labelledby="byItem" class="lg:col-span-2">
				<h2 id="byItem" class="mb-2 text-sm font-semibold text-ink">Top dishes</h2>
				<div class="overflow-x-auto rounded-xl border border-border">
					<Table.Root>
						<Table.Header><Table.Row><Table.Head>Dish</Table.Head><Table.Head class="text-right">Sold</Table.Head><Table.Head class="text-right">Sales</Table.Head></Table.Row></Table.Header>
						<Table.Body>
							{#each r.byItem as i (i.name)}
								<Table.Row><Table.Cell>{i.name}</Table.Cell><Table.Cell class="text-right tabular-nums">{i.quantity}</Table.Cell><Table.Cell class="text-right tabular-nums">{peso(i.grossCentavos)}</Table.Cell></Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			</section>
		</div>
		<p class="mt-4 text-xs text-ink-muted">Counts paid orders by the day they were paid, and orders charged to a room by the day they were charged. A voided payment is taken back out. Room charges reach Finance as dining income when the guest pays their room bill.</p>
	{/if}
</div>
