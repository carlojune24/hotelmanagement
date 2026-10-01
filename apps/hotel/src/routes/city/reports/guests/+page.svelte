<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import MonthlyChart from '$lib/components/city/monthly-chart.svelte';
	import PeriodFilter from '$lib/components/city/period-filter.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const { report } = $derived(data);
	const day = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'UTC' });
	const fmtDay = (s: string) => day.format(new Date(`${s}T00:00:00Z`));

	const n = new Intl.NumberFormat('en-PH');
	const fmt = (v: number) => n.format(v);
	const compact = (v: number) =>
		v >= 10_000 ? new Intl.NumberFormat('en-PH', { notation: 'compact', maximumFractionDigits: 1 }).format(v) : n.format(v);

	const exportHref = $derived(
		`/city/reports/guests/export.csv?range=custom&from=${data.range.from}&to=${data.range.to}`
	);
	const hotelsWithGuests = $derived(report.hotels.filter((h) => h.guests > 0));
</script>

<svelte:head><title>Guests — City management</title></svelte:head>

<div class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<h1 class="text-xl font-semibold tracking-tight text-ink">Guests</h1>
		<Button variant="outline" href={exportHref} data-sveltekit-reload>Export CSV</Button>
	</div>

	<div class="mt-5"><PeriodFilter range={data.range} /></div>
	<p class="mt-3 text-sm text-ink-muted">
		Stays that checked in {fmtDay(data.range.from)} – {fmtDay(data.range.to)}
	</p>

	<!-- Consolidated figures: a ruled line of facts, not tiles -->
	<dl class="mt-4 grid divide-y divide-border border-y border-border sm:grid-cols-4 sm:divide-x sm:divide-y-0">
		<div class="py-3 sm:pr-5">
			<dt class="text-sm text-ink-muted">Guests, all hotels</dt>
			<dd class="mt-0.5 font-mono text-lg font-medium tabular-nums text-ink">{fmt(report.totals.guests)}</dd>
		</div>
		<div class="py-3 sm:px-5">
			<dt class="text-sm text-ink-muted">Stays</dt>
			<dd class="mt-0.5 font-mono text-lg font-medium tabular-nums text-ink">{fmt(report.totals.stays)}</dd>
		</div>
		<div class="py-3 sm:px-5">
			<dt class="text-sm text-ink-muted">Average stay</dt>
			<dd class="mt-0.5 font-mono text-lg font-medium tabular-nums text-ink">
				{report.totals.avgNights ?? '—'}<span class="text-sm font-normal text-ink-muted"> nights</span>
			</dd>
		</div>
		<div class="py-3 sm:pl-5">
			<dt class="text-sm text-ink-muted">Hotels with guests</dt>
			<dd class="mt-0.5 font-mono text-lg font-medium tabular-nums text-ink">
				{report.reporting}<span class="text-sm font-normal text-ink-muted"> of {report.hotels.length}</span>
			</dd>
		</div>
	</dl>

	<section class="mt-8">
		{#if report.totals.guests === 0}
			<p class="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-ink-muted">
				No guests checked in during this period. Try a longer range, or check that hotels are
				checking guests in at the front desk.
			</p>
		{:else}
			<MonthlyChart
				title="Guests by month, all hotels"
				months={report.months.map((m) => ({ month: m.month, value: m.guests }))}
				formatValue={(v) => `${fmt(v)} ${v === 1 ? 'guest' : 'guests'}`}
				formatAxis={compact}
				valueHeader="Guests"
			/>
		{/if}
	</section>

	{#if hotelsWithGuests.length > 0}
		<section class="mt-10">
			<h2 class="text-sm font-semibold text-ink">Each hotel</h2>
			<p class="mt-1 text-xs text-ink-muted">Every chart uses the same scale, so heights compare across hotels.</p>
			<div class="mt-4 grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
				{#each hotelsWithGuests as h (h.id)}
					<div>
						<div class="flex items-baseline justify-between gap-2">
							<a class="truncate text-sm font-medium text-brand hover:underline" href="/city/hotels/{h.id}">{h.name}</a>
							<span class="shrink-0 font-mono text-xs tabular-nums text-ink-muted">{fmt(h.guests)}</span>
						</div>
						<MonthlyChart
							compact
							title="Guests by month"
							months={h.monthly.map((m) => ({ month: m.month, value: m.guests }))}
							sharedMax={report.maxHotelMonth}
							formatValue={(v) => `${fmt(v)} ${v === 1 ? 'guest' : 'guests'}`}
							formatAxis={compact}
						/>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<section class="mt-10">
		<h2 class="text-sm font-semibold text-ink">By hotel</h2>
		{#if report.hotels.length === 0}
			<p class="mt-3 text-sm text-ink-muted">No hotels yet.</p>
		{:else}
			<Table.Root class="mt-2">
				<Table.Header>
					<Table.Row>
						<Table.Head>Hotel</Table.Head>
						<Table.Head class="text-right">Guests</Table.Head>
						<Table.Head class="text-right">Stays</Table.Head>
						<Table.Head class="text-right">Guest-nights</Table.Head>
						<Table.Head class="text-right">Avg nights per stay</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each report.hotels as h (h.id)}
						<Table.Row>
							<Table.Cell>
								<a class="font-medium text-brand hover:underline" href="/city/hotels/{h.id}">{h.name}</a>
							</Table.Cell>
							<Table.Cell class="text-right font-mono text-xs font-medium tabular-nums text-ink">{h.guests ? fmt(h.guests) : '—'}</Table.Cell>
							<Table.Cell class="text-right font-mono text-xs tabular-nums">{h.stays ? fmt(h.stays) : '—'}</Table.Cell>
							<Table.Cell class="text-right font-mono text-xs tabular-nums">{h.guestNights ? fmt(h.guestNights) : '—'}</Table.Cell>
							<Table.Cell class="text-right font-mono text-xs tabular-nums">{h.avgNights ?? '—'}</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
				<Table.Footer>
					<Table.Row>
						<Table.Cell class="font-medium">All hotels</Table.Cell>
						<Table.Cell class="text-right font-mono text-xs font-semibold tabular-nums">{fmt(report.totals.guests)}</Table.Cell>
						<Table.Cell class="text-right font-mono text-xs tabular-nums">{fmt(report.totals.stays)}</Table.Cell>
						<Table.Cell class="text-right font-mono text-xs tabular-nums">{fmt(report.totals.guestNights)}</Table.Cell>
						<Table.Cell class="text-right font-mono text-xs tabular-nums">{report.totals.avgNights ?? '—'}</Table.Cell>
					</Table.Row>
				</Table.Footer>
			</Table.Root>
		{/if}
	</section>

	<p class="mt-6 max-w-[68ch] text-xs leading-relaxed text-ink-muted">
		A guest is a person on a stay that has checked in or out, counted by the stay's check-in date. A
		stay's party size is the head-count recorded on the booking, so a guest who stays twice counts
		twice. Cancelled, no-show, unpaid and not-yet-arrived bookings are not counted. Guest-nights are
		party size × nights.
	</p>
</div>
