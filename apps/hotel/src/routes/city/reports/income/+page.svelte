<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import RevenueChart from '$lib/components/city/revenue-chart.svelte';
	import { RANGE_LABEL, RANGE_PRESETS, formatPeso } from '$lib/city/income';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const { report } = $derived(data);
	const presets = RANGE_PRESETS.filter((p) => p !== 'custom');
	const day = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'UTC' });
	const fmtDay = (s: string) => day.format(new Date(`${s}T00:00:00Z`));

	const exportHref = $derived(
		`/city/reports/income/export.csv?range=custom&from=${data.range.from}&to=${data.range.to}`
	);
	const money = (c: number) => (c === 0 ? '—' : formatPeso(c));
</script>

<svelte:head><title>Income report — City management</title></svelte:head>

<div class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<h1 class="text-xl font-semibold tracking-tight text-ink">Income report</h1>
		<Button variant="outline" href={exportHref} data-sveltekit-reload>Export CSV</Button>
	</div>

	<!-- Filters: one row above everything they scope -->
	<div class="mt-5 flex flex-wrap items-end gap-x-6 gap-y-3">
		<nav class="flex flex-wrap gap-1" aria-label="Period">
			{#each presets as p (p)}
				<a
					href="?range={p}"
					aria-current={data.range.preset === p ? 'page' : undefined}
					class="rounded-md px-2.5 py-1.5 text-sm {data.range.preset === p
						? 'bg-brand/15 font-medium text-ink'
						: 'text-ink-muted hover:bg-surface-2 hover:text-ink'}"
				>
					{RANGE_LABEL[p]}
				</a>
			{/each}
		</nav>
		<form method="GET" class="flex flex-wrap items-end gap-2">
			<input type="hidden" name="range" value="custom" />
			<div>
				<Label for="from" class="text-xs text-ink-muted">From</Label>
				<Input id="from" name="from" type="date" value={data.range.from} required class="mt-1 h-8 w-40" />
			</div>
			<div>
				<Label for="to" class="text-xs text-ink-muted">To</Label>
				<Input id="to" name="to" type="date" value={data.range.to} required class="mt-1 h-8 w-40" />
			</div>
			<Button type="submit" variant={data.range.preset === 'custom' ? 'default' : 'outline'} class="h-8">
				Apply
			</Button>
		</form>
	</div>
	{#if data.range.error}
		<p class="mt-2 text-sm text-danger" role="alert">{data.range.error} Showing the last 12 months.</p>
	{/if}
	<p class="mt-3 text-sm text-ink-muted">
		{fmtDay(data.range.from)} – {fmtDay(data.range.to)}
	</p>

	<!-- Summary: a ruled line of facts, not tiles -->
	<dl class="mt-4 grid divide-y divide-border border-y border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
		<div class="py-3 sm:pr-5">
			<dt class="text-sm text-ink-muted">Total revenue</dt>
			<dd class="mt-0.5 font-mono text-lg font-medium text-ink">{formatPeso(report.totals.total)}</dd>
		</div>
		<div class="py-3 sm:px-5">
			<dt class="text-sm text-ink-muted">Hotels with revenue</dt>
			<dd class="mt-0.5 font-mono text-lg font-medium tabular-nums text-ink">
				{report.reporting}<span class="text-sm font-normal text-ink-muted"> of {report.hotels.length}</span>
			</dd>
		</div>
		<div class="py-3 sm:pl-5">
			<dt class="text-sm text-ink-muted">Refunds paid out</dt>
			<dd class="mt-0.5 font-mono text-lg font-medium text-ink">{formatPeso(report.totals.refunds)}</dd>
		</div>
	</dl>

	<section class="mt-8">
		{#if report.totals.total === 0}
			<p class="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-ink-muted">
				No revenue was recorded in this period. Try a longer range, or check that hotels are recording
				payments in their Finance module.
			</p>
		{:else}
			<RevenueChart months={report.months} />
		{/if}
	</section>

	<section class="mt-10">
		<h2 class="text-sm font-semibold text-ink">By hotel</h2>
		{#if report.hotels.length === 0}
			<p class="mt-3 text-sm text-ink-muted">No hotels yet.</p>
		{:else}
			<Table.Root class="mt-2">
				<Table.Header>
					<Table.Row>
						<Table.Head>Hotel</Table.Head>
						<Table.Head class="text-right">Rooms</Table.Head>
						<Table.Head class="text-right">Function halls</Table.Head>
						<Table.Head class="text-right">Other sales</Table.Head>
						<Table.Head class="text-right">Deposits</Table.Head>
						<Table.Head class="text-right">Total revenue</Table.Head>
						<Table.Head class="text-right">Refunds</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each report.hotels as h (h.id)}
						<Table.Row>
							<Table.Cell>
								<a class="font-medium text-brand hover:underline" href="/city/hotels/{h.id}">{h.name}</a>
							</Table.Cell>
							<Table.Cell class="text-right font-mono text-xs tabular-nums">{money(h.rooms)}</Table.Cell>
							<Table.Cell class="text-right font-mono text-xs tabular-nums">{money(h.halls)}</Table.Cell>
							<Table.Cell class="text-right font-mono text-xs tabular-nums">{money(h.other)}</Table.Cell>
							<Table.Cell class="text-right font-mono text-xs tabular-nums">{money(h.deposits)}</Table.Cell>
							<Table.Cell class="text-right font-mono text-xs font-medium tabular-nums text-ink"
								>{money(h.total)}</Table.Cell
							>
							<Table.Cell class="text-right font-mono text-xs tabular-nums text-ink-muted"
								>{money(h.refunds)}</Table.Cell
							>
						</Table.Row>
					{/each}
				</Table.Body>
				<Table.Footer>
					<Table.Row>
						<Table.Cell class="font-medium">All hotels</Table.Cell>
						<Table.Cell class="text-right font-mono text-xs tabular-nums">{money(report.totals.rooms)}</Table.Cell>
						<Table.Cell class="text-right font-mono text-xs tabular-nums">{money(report.totals.halls)}</Table.Cell>
						<Table.Cell class="text-right font-mono text-xs tabular-nums">{money(report.totals.other)}</Table.Cell>
						<Table.Cell class="text-right font-mono text-xs tabular-nums"
							>{money(report.totals.deposits)}</Table.Cell
						>
						<Table.Cell class="text-right font-mono text-xs font-semibold tabular-nums"
							>{money(report.totals.total)}</Table.Cell
						>
						<Table.Cell class="text-right font-mono text-xs tabular-nums text-ink-muted"
							>{money(report.totals.refunds)}</Table.Cell
						>
					</Table.Row>
				</Table.Footer>
			</Table.Root>
		{/if}
	</section>

	<p class="mt-6 max-w-[68ch] text-xs leading-relaxed text-ink-muted">
		Cash-basis: money actually received, counted on each hotel's own business date, using the same
		definition as every hotel's Finance reports (voided payments excluded). Deposits are included in
		total revenue, as in the hotels' own reports. Refunds are shown separately and are not subtracted.
		Room-night measures such as ADR and RevPAR are not shown here: they depend on stay nights, which
		cash receipts don't measure.
	</p>
</div>
