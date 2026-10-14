<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import PrinterIcon from '@lucide/svelte/icons/printer';
	import ChartNoAxesColumnIcon from '@lucide/svelte/icons/chart-no-axes-column';
	import DailySalesChart from '$lib/components/dining/daily-sales-chart.svelte';
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
	const METHOD: Record<string, string> = { cash: 'Cash', card: 'Card', gcash: 'GCash', maya: 'Maya', paymongo: 'Online (PayMongo)', bank_transfer: 'Bank transfer', cheque: 'Cheque', house_use: 'House use', room_charge: 'Charged to room', unknown: 'Unknown' };

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
			<Button href="/{page.params.hotel}/print/dining-sales?{query({ from: data.from, to: data.to })}" target="_blank" rel="noopener" variant="outline" size="sm">
				<PrinterIcon class="size-4" /> Print
			</Button>
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

		<section aria-labelledby="trend" class="mt-6">
			<h2 id="trend" class="mb-2 text-sm font-semibold text-ink">Sales trend</h2>
			<div class="rounded-xl border border-border bg-surface p-3"><DailySalesChart days={r.byDay} /></div>
		</section>

		<div class="mt-6 space-y-8">
			<section aria-labelledby="byDay">
				<h2 id="byDay" class="mb-2 text-sm font-semibold text-ink">By day</h2>
				<div class="overflow-x-auto rounded-xl border border-border">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Date</Table.Head>
								<Table.Head class="w-36 text-right">Orders</Table.Head>
								<Table.Head class="w-36 text-right">Sales</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each r.byDay as d (d.date)}
								<Table.Row>
									<Table.Cell class="text-ink">{fmtDay(d.date)}</Table.Cell>
									<Table.Cell class="text-right tabular-nums text-ink-muted">{d.orders}</Table.Cell>
									<Table.Cell class="text-right font-medium tabular-nums text-ink">{peso(d.grossCentavos)}</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
						<Table.Footer>
							<Table.Row>
								<Table.Cell class="text-ink">Total</Table.Cell>
								<Table.Cell class="text-right tabular-nums text-ink">{r.orders}</Table.Cell>
								<Table.Cell class="text-right tabular-nums text-ink">{peso(r.grossCentavos)}</Table.Cell>
							</Table.Row>
						</Table.Footer>
					</Table.Root>
				</div>
			</section>

			<section aria-labelledby="byMethod">
				<h2 id="byMethod" class="mb-2 text-sm font-semibold text-ink">By payment method</h2>
				<div class="overflow-x-auto rounded-xl border border-border">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Method</Table.Head>
								<Table.Head class="w-36 text-right">Orders</Table.Head>
								<Table.Head class="w-36 text-right">Sales</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each r.byMethod as m (m.method)}
								<Table.Row>
									<Table.Cell class="text-ink">{METHOD[m.method] ?? m.method}</Table.Cell>
									<Table.Cell class="text-right tabular-nums text-ink-muted">{m.orders}</Table.Cell>
									<Table.Cell class="text-right font-medium tabular-nums text-ink">{peso(m.grossCentavos)}</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
						<Table.Footer>
							<Table.Row>
								<Table.Cell class="text-ink">Total</Table.Cell>
								<Table.Cell class="text-right tabular-nums text-ink">{r.orders}</Table.Cell>
								<Table.Cell class="text-right tabular-nums text-ink">{peso(r.grossCentavos)}</Table.Cell>
							</Table.Row>
						</Table.Footer>
					</Table.Root>
				</div>
			</section>

			{#if r.byVenue.length > 1}
				<section aria-labelledby="byVenue">
					<h2 id="byVenue" class="mb-2 text-sm font-semibold text-ink">By venue</h2>
					<div class="overflow-x-auto rounded-xl border border-border">
						<Table.Root>
							<Table.Header>
								<Table.Row>
									<Table.Head>Venue</Table.Head>
									<Table.Head class="w-36 text-right">Orders</Table.Head>
									<Table.Head class="w-36 text-right">Sales</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each r.byVenue as v (v.venueId)}
									<Table.Row>
										<Table.Cell class="text-ink">{v.venue}</Table.Cell>
										<Table.Cell class="text-right tabular-nums text-ink-muted">{v.orders}</Table.Cell>
										<Table.Cell class="text-right font-medium tabular-nums text-ink">{peso(v.grossCentavos)}</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
							<Table.Footer>
								<Table.Row>
									<Table.Cell class="text-ink">Total</Table.Cell>
									<Table.Cell class="text-right tabular-nums text-ink">{r.orders}</Table.Cell>
									<Table.Cell class="text-right tabular-nums text-ink">{peso(r.grossCentavos)}</Table.Cell>
								</Table.Row>
							</Table.Footer>
						</Table.Root>
					</div>
				</section>
			{/if}

			<section aria-labelledby="byStation">
				<h2 id="byStation" class="mb-2 text-sm font-semibold text-ink">By station</h2>
				<div class="overflow-x-auto rounded-xl border border-border">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Station</Table.Head>
								<Table.Head class="w-36 text-right">Items</Table.Head>
								<Table.Head class="w-36 text-right">Sales</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each r.byStation as st (st.station)}
								<Table.Row>
									<Table.Cell class="text-ink">{st.station}</Table.Cell>
									<Table.Cell class="text-right tabular-nums text-ink-muted">{st.quantity}</Table.Cell>
									<Table.Cell class="text-right font-medium tabular-nums text-ink">{peso(st.grossCentavos)}</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
						<Table.Footer>
							<Table.Row>
								<Table.Cell class="text-ink">Total</Table.Cell>
								<Table.Cell class="text-right tabular-nums text-ink">{r.byStation.reduce((s, x) => s + x.quantity, 0)}</Table.Cell>
								<Table.Cell class="text-right tabular-nums text-ink">{peso(r.byStation.reduce((s, x) => s + x.grossCentavos, 0))}</Table.Cell>
							</Table.Row>
						</Table.Footer>
					</Table.Root>
				</div>
			</section>

			<section aria-labelledby="byItem">
				<h2 id="byItem" class="mb-2 text-sm font-semibold text-ink">Top dishes</h2>
				<div class="overflow-x-auto rounded-xl border border-border">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Dish</Table.Head>
								<Table.Head class="w-36 text-right">Sold</Table.Head>
								<Table.Head class="w-36 text-right">Sales</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each r.byItem as i (i.name)}
								<Table.Row>
									<Table.Cell class="text-ink">{i.name}</Table.Cell>
									<Table.Cell class="text-right tabular-nums text-ink-muted">{i.quantity}</Table.Cell>
									<Table.Cell class="text-right font-medium tabular-nums text-ink">{peso(i.grossCentavos)}</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			</section>
		</div>
		<p class="mt-4 text-xs text-ink-muted">Counts paid orders by the day they were paid, and orders charged to a room by the day they were charged. A voided payment is taken back out. Room charges reach Finance as dining income when the guest pays their room bill. Sales counts orders; <a class="underline" href="{base}/cashflow?{query({ from: data.from, to: data.to })}">Cashflow</a> counts the money actually received.</p>
	{/if}
</div>
