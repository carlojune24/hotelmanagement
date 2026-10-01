<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import MonthlyChart from '$lib/components/city/monthly-chart.svelte';
	import PeriodFilter from '$lib/components/city/period-filter.svelte';
	import { formatPeso, monthLabel } from '$lib/city/income';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const { report } = $derived(data);
	const day = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'UTC' });
	const fmtDay = (s: string) => day.format(new Date(`${s}T00:00:00Z`));
	const n = new Intl.NumberFormat('en-PH');

	const exportHref = $derived(
		`/city/reports/occupancy/export.csv?range=custom&from=${data.range.from}&to=${data.range.to}`
	);

	const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)}%`);
	const peso = (c: number | null) => (c === null ? '—' : formatPeso(c));
	const count = (v: number) => (v ? n.format(v) : '—');
	const startedMidRange = (opened: string | null) => opened !== null && opened > data.range.from;
</script>

<svelte:head><title>Occupancy — City management</title></svelte:head>

<div class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<h1 class="text-xl font-semibold tracking-tight text-ink">Occupancy and rates</h1>
		<Button variant="outline" href={exportHref} data-sveltekit-reload>Export CSV</Button>
	</div>

	<div class="mt-5"><PeriodFilter range={data.range} /></div>
	<p class="mt-3 text-sm text-ink-muted">
		Nights stayed {fmtDay(data.range.from)} – {fmtDay(data.range.to < data.today ? data.range.to : data.today)}
	</p>

	<!-- Consolidated figures: a ruled line of facts, not tiles -->
	<dl class="mt-4 grid divide-y divide-border border-y border-border sm:grid-cols-4 sm:divide-x sm:divide-y-0">
		<div class="py-3 sm:pr-5">
			<dt class="text-sm text-ink-muted">Occupancy, all hotels</dt>
			<dd class="mt-0.5 font-mono text-lg font-medium tabular-nums text-ink">{pct(report.totals.occupancyPct)}</dd>
		</div>
		<div class="py-3 sm:px-5">
			<dt class="text-sm text-ink-muted">Average daily rate (ADR)</dt>
			<dd class="mt-0.5 font-mono text-lg font-medium tabular-nums text-ink">{peso(report.totals.adrCentavos)}</dd>
		</div>
		<div class="py-3 sm:px-5">
			<dt class="text-sm text-ink-muted">Revenue per available room (RevPAR)</dt>
			<dd class="mt-0.5 font-mono text-lg font-medium tabular-nums text-ink">{peso(report.totals.revparCentavos)}</dd>
		</div>
		<div class="py-3 sm:pl-5">
			<dt class="text-sm text-ink-muted">Room-nights sold</dt>
			<dd class="mt-0.5 font-mono text-lg font-medium tabular-nums text-ink">
				{n.format(report.totals.roomNightsSold)}<span class="text-sm font-normal text-ink-muted">
					of {n.format(report.totals.roomNightsAvailable)}</span
				>
			</dd>
		</div>
	</dl>

	<section class="mt-8">
		{#if report.totals.roomNightsSold === 0}
			<p class="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-ink-muted">
				No room-nights were sold in this period. Try a longer range, or check that hotels are
				checking guests in at the front desk.
			</p>
		{:else}
			<MonthlyChart
				title="Occupancy by month, all hotels"
				months={report.months.map((m) => ({ month: m.month, value: m.occupancyPct ?? 0 }))}
				formatValue={(v) => `${v.toFixed(1)}% occupied`}
				formatAxis={(v) => `${Math.round(v)}%`}
				valueHeader="Occupancy"
			/>
		{/if}
	</section>

	<section class="mt-10">
		<h2 class="text-sm font-semibold text-ink">By month</h2>
		<Table.Root class="mt-2">
			<Table.Header>
				<Table.Row>
					<Table.Head>Month</Table.Head>
					<Table.Head class="text-right">Room-nights sold</Table.Head>
					<Table.Head class="text-right">Available</Table.Head>
					<Table.Head class="text-right">Occupancy</Table.Head>
					<Table.Head class="text-right">ADR</Table.Head>
					<Table.Head class="text-right">RevPAR</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each report.months as m (m.month)}
					<Table.Row>
						<Table.Cell>{monthLabel(m.month)}</Table.Cell>
						<Table.Cell class="text-right font-mono text-xs tabular-nums">{count(m.roomNightsSold)}</Table.Cell>
						<Table.Cell class="text-right font-mono text-xs tabular-nums text-ink-muted">{count(m.roomNightsAvailable)}</Table.Cell>
						<Table.Cell class="text-right font-mono text-xs font-medium tabular-nums text-ink">{pct(m.occupancyPct)}</Table.Cell>
						<Table.Cell class="text-right font-mono text-xs tabular-nums">{peso(m.adrCentavos)}</Table.Cell>
						<Table.Cell class="text-right font-mono text-xs tabular-nums">{peso(m.revparCentavos)}</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
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
						<Table.Head class="text-right">Room-nights sold</Table.Head>
						<Table.Head class="text-right">Available</Table.Head>
						<Table.Head class="text-right">Occupancy</Table.Head>
						<Table.Head class="text-right">ADR</Table.Head>
						<Table.Head class="text-right">RevPAR</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each report.hotels as h (h.id)}
						<Table.Row>
							<Table.Cell>
								<a class="font-medium text-brand hover:underline" href="/city/hotels/{h.id}">{h.name}</a>
								{#if h.openedOn === null}
									<span class="block text-xs text-ink-muted">No stays recorded yet</span>
								{:else if startedMidRange(h.openedOn)}
									<span class="block text-xs text-ink-muted">Counted from first stay, {fmtDay(h.openedOn)}</span>
								{/if}
							</Table.Cell>
							<Table.Cell class="text-right font-mono text-xs tabular-nums">{count(h.rooms)}</Table.Cell>
							<Table.Cell class="text-right font-mono text-xs tabular-nums">{count(h.roomNightsSold)}</Table.Cell>
							<Table.Cell class="text-right font-mono text-xs tabular-nums text-ink-muted">{count(h.roomNightsAvailable)}</Table.Cell>
							<Table.Cell class="text-right font-mono text-xs font-medium tabular-nums text-ink">{pct(h.occupancyPct)}</Table.Cell>
							<Table.Cell class="text-right font-mono text-xs tabular-nums">{peso(h.adrCentavos)}</Table.Cell>
							<Table.Cell class="text-right font-mono text-xs tabular-nums">{peso(h.revparCentavos)}</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
				<Table.Footer>
					<Table.Row>
						<Table.Cell class="font-medium">All hotels</Table.Cell>
						<Table.Cell class="text-right font-mono text-xs tabular-nums">{count(report.totals.rooms)}</Table.Cell>
						<Table.Cell class="text-right font-mono text-xs tabular-nums">{count(report.totals.roomNightsSold)}</Table.Cell>
						<Table.Cell class="text-right font-mono text-xs tabular-nums text-ink-muted">{count(report.totals.roomNightsAvailable)}</Table.Cell>
						<Table.Cell class="text-right font-mono text-xs font-semibold tabular-nums">{pct(report.totals.occupancyPct)}</Table.Cell>
						<Table.Cell class="text-right font-mono text-xs tabular-nums">{peso(report.totals.adrCentavos)}</Table.Cell>
						<Table.Cell class="text-right font-mono text-xs tabular-nums">{peso(report.totals.revparCentavos)}</Table.Cell>
					</Table.Row>
				</Table.Footer>
			</Table.Root>
		{/if}
	</section>

	<p class="mt-6 max-w-[68ch] text-xs leading-relaxed text-ink-muted">
		Counted by nights stayed, not by payment date, so these figures will differ from the cash-basis
		income report. Only stays that have checked in or out count. Room-nights available are a hotel's
		active rooms × the days since its first recorded stay (never past today), using today's room
		count. ADR is room revenue ÷ room-nights sold; RevPAR is room revenue ÷ room-nights available.
		Room revenue is each stay's room price before VAT and fees, spread evenly over its nights.
	</p>
</div>
