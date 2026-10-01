<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import MonthlyChart from '$lib/components/city/monthly-chart.svelte';
	import PeriodFilter from '$lib/components/city/period-filter.svelte';
	import { formatPeso } from '$lib/city/income';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const day = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'UTC' });
	const fmtDay = (s: string) => day.format(new Date(`${s}T00:00:00Z`));
	const n = new Intl.NumberFormat('en-PH');
	const compact = (v: number) =>
		v >= 10_000 ? new Intl.NumberFormat('en-PH', { notation: 'compact', maximumFractionDigits: 1 }).format(v) : n.format(v);
	const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)}%`);

	// Same link shape on every report: keep the chosen period when drilling in.
	const q = $derived(`?range=custom&from=${data.range.from}&to=${data.range.to}`);

	const toneClass = { warn: 'text-danger', todo: 'text-ink', info: 'text-ink-muted' } as const;
</script>

<svelte:head><title>Overview — City management</title></svelte:head>

<div class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
	<h1 class="text-xl font-semibold tracking-tight text-ink">Overview</h1>
	<p class="mt-1 text-sm text-ink-muted">
		<span class="font-mono tabular-nums">{data.platform.hotels}</span> hotels
		(<span class="font-mono tabular-nums">{data.platform.published}</span> published) ·
		<span class="font-mono tabular-nums">{data.platform.rooms}</span> rooms ·
		<span class="font-mono tabular-nums">{data.platform.users}</span> users
	</p>

	<div class="mt-5"><PeriodFilter range={data.range} /></div>
	<p class="mt-3 text-sm text-ink-muted">{fmtDay(data.range.from)} – {fmtDay(data.range.to)}</p>

	<!-- Headline figures, each linking to the report it comes from -->
	<dl class="mt-4 grid divide-y divide-border border-y border-border sm:grid-cols-4 sm:divide-x sm:divide-y-0">
		<a href="/city/reports/guests{q}" class="block py-3 hover:bg-surface-2 sm:pr-5">
			<dt class="text-sm text-ink-muted">Guests</dt>
			<dd class="mt-0.5 font-mono text-lg font-medium tabular-nums text-ink">{n.format(data.visitors.totals.guests)}</dd>
		</a>
		<a href="/city/reports/occupancy{q}" class="block py-3 hover:bg-surface-2 sm:px-5">
			<dt class="text-sm text-ink-muted">Occupancy</dt>
			<dd class="mt-0.5 font-mono text-lg font-medium tabular-nums text-ink">{pct(data.occupancy.totals.occupancyPct)}</dd>
		</a>
		<a href="/city/reports/income{q}" class="block py-3 hover:bg-surface-2 sm:px-5">
			<dt class="text-sm text-ink-muted">Revenue received</dt>
			<dd class="mt-0.5 font-mono text-lg font-medium text-ink">{formatPeso(data.income.totals.total)}</dd>
		</a>
		<a href="/city/reports/ratings{q}" class="block py-3 hover:bg-surface-2 sm:pl-5">
			<dt class="text-sm text-ink-muted">Average rating</dt>
			<dd class="mt-0.5 font-mono text-lg font-medium tabular-nums text-ink">
				{data.ratings.totals.avg?.toFixed(1) ?? '—'}<span class="text-sm font-normal text-ink-muted">
					/ 5 · {n.format(data.ratings.totals.count)} reviews</span
				>
			</dd>
		</a>
	</dl>

	<div class="mt-8 grid gap-x-10 gap-y-8 lg:grid-cols-2">
		{#if data.visitors.totals.guests > 0}
			<MonthlyChart
				title="Guests by month"
				months={data.visitors.months.map((m) => ({ month: m.month, value: m.guests }))}
				formatValue={(v) => `${n.format(v)} ${v === 1 ? 'guest' : 'guests'}`}
				formatAxis={compact}
				valueHeader="Guests"
			/>
		{:else}
			<p class="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-ink-muted">
				No guests checked in during this period.
			</p>
		{/if}
		{#if data.income.totals.total > 0}
			<MonthlyChart
				title="Revenue received by month"
				months={data.income.months.map((m) => ({ month: m.month, value: m.revenueCentavos }))}
				unit={100}
				formatValue={formatPeso}
				formatAxis={(c) => `₱${(c / 100 >= 10_000 ? compact(c / 100) : n.format(c / 100))}`}
				valueHeader="Revenue"
			/>
		{:else}
			<p class="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-ink-muted">
				No revenue was recorded in this period.
			</p>
		{/if}
	</div>

	<section class="mt-10">
		<h2 class="text-sm font-semibold text-ink">Needs attention</h2>
		{#if data.attention.length === 0}
			<p class="mt-2 text-sm text-ink-muted">Nothing is waiting on the city right now.</p>
		{:else}
			<ul class="mt-2 divide-y divide-border border-y border-border">
				{#each data.attention as a (a.key)}
					<li>
						<a href={a.href} class="flex items-baseline justify-between gap-4 py-2.5 text-sm hover:bg-surface-2">
							<span class={toneClass[a.tone]}>{a.label}</span>
							<span class="font-mono tabular-nums {toneClass[a.tone]}">{n.format(a.count)}</span>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="mt-10">
		<h2 class="text-sm font-semibold text-ink">Hotels at a glance</h2>
		{#if data.glance.length === 0}
			<p class="mt-2 text-sm text-ink-muted">No hotels yet.</p>
		{:else}
			<Table.Root class="mt-2">
				<Table.Header>
					<Table.Row>
						<Table.Head>Hotel</Table.Head>
						<Table.Head class="text-right">Guests</Table.Head>
						<Table.Head class="text-right">Occupancy</Table.Head>
						<Table.Head class="text-right">Revenue received</Table.Head>
						<Table.Head class="text-right">Rating</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.glance as h (h.id)}
						<Table.Row>
							<Table.Cell>
								<a class="font-medium text-brand hover:underline" href="/city/hotels/{h.id}">{h.name}</a>
							</Table.Cell>
							<Table.Cell class="text-right font-mono text-xs tabular-nums">{h.guests ? n.format(h.guests) : '—'}</Table.Cell>
							<Table.Cell class="text-right font-mono text-xs tabular-nums">{pct(h.occupancyPct)}</Table.Cell>
							<Table.Cell class="text-right font-mono text-xs font-medium tabular-nums text-ink">
								{h.revenueCentavos ? formatPeso(h.revenueCentavos) : '—'}
							</Table.Cell>
							<Table.Cell class="text-right font-mono text-xs tabular-nums">
								{#if h.rating !== null}
									{h.rating.toFixed(1)}<span class="text-ink-muted"> ({h.reviewCount})</span>
								{:else}
									<span class="font-sans text-ink-muted">Not yet rated</span>
								{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</section>

	<p class="mt-6 max-w-[68ch] text-xs leading-relaxed text-ink-muted">
		Each figure is the same one shown on its own report for this period: guests, occupancy, revenue
		received (cash-basis) and rating. Select a headline figure to open that report with the same dates.
	</p>
</div>
