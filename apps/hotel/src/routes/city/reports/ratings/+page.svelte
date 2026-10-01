<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import PeriodFilter from '$lib/components/city/period-filter.svelte';
	import { MIN_REVIEWS_FOR_RANK, STARS } from '$lib/city/ratings';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const { report } = $derived(data);
	const day = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'UTC' });
	const fmtDay = (s: string) => day.format(new Date(`${s}T00:00:00Z`));
	const n = new Intl.NumberFormat('en-PH');

	const exportHref = $derived(
		`/city/reports/ratings/export.csv?range=custom&from=${data.range.from}&to=${data.range.to}`
	);

	const distMax = $derived(Math.max(1, ...report.totals.distribution));
	// Rank only established hotels (enough reviews); small samples and unrated hotels get a dash.
	const rankOf = $derived(
		new Map(
			report.hotels.filter((h) => h.count > 0 && !h.fewReviews).map((h, i) => [h.id, i + 1] as const)
		)
	);
	const pct = (count: number) => (report.totals.count ? Math.round((count / report.totals.count) * 100) : 0);
</script>

<svelte:head><title>Ratings — City management</title></svelte:head>

<div class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<h1 class="text-xl font-semibold tracking-tight text-ink">Ratings</h1>
		<Button variant="outline" href={exportHref} data-sveltekit-reload>Export CSV</Button>
	</div>

	<div class="mt-5"><PeriodFilter range={data.range} /></div>
	<p class="mt-3 text-sm text-ink-muted">
		Approved reviews submitted {fmtDay(data.range.from)} – {fmtDay(data.range.to)}
	</p>

	<!-- Consolidated figures: a ruled line of facts, not tiles -->
	<dl class="mt-4 grid divide-y divide-border border-y border-border sm:grid-cols-4 sm:divide-x sm:divide-y-0">
		<div class="py-3 sm:pr-5">
			<dt class="text-sm text-ink-muted">Average rating</dt>
			<dd class="mt-0.5 font-mono text-lg font-medium tabular-nums text-ink">
				{report.totals.avg?.toFixed(1) ?? '—'}<span class="text-sm font-normal text-ink-muted"> / 5</span>
			</dd>
		</div>
		<div class="py-3 sm:px-5">
			<dt class="text-sm text-ink-muted">Approved reviews</dt>
			<dd class="mt-0.5 font-mono text-lg font-medium tabular-nums text-ink">{n.format(report.totals.count)}</dd>
		</div>
		<div class="py-3 sm:px-5">
			<dt class="text-sm text-ink-muted">Hotels rated</dt>
			<dd class="mt-0.5 font-mono text-lg font-medium tabular-nums text-ink">
				{report.totals.hotelsRated}<span class="text-sm font-normal text-ink-muted"> of {report.hotels.length}</span>
			</dd>
		</div>
		<div class="py-3 sm:pl-5">
			<dt class="text-sm text-ink-muted">Awaiting hotel approval</dt>
			<dd class="mt-0.5 font-mono text-lg font-medium tabular-nums text-ink">{n.format(report.totals.pending)}</dd>
		</div>
	</dl>

	{#if report.totals.count === 0}
		<p class="mt-8 rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-ink-muted">
			No approved reviews in this period. Guests can review a stay after checking out; hotel staff
			approve each review before it counts here.
		</p>
	{:else}
		<section class="mt-8">
			<h2 class="text-sm font-semibold text-ink">How guests rated, all hotels</h2>
			<ul class="mt-3 max-w-xl space-y-1.5">
				{#each STARS as s (s)}
					{@const c = report.totals.distribution[s - 1]!}
					<li class="grid grid-cols-[4.5rem_1fr_7rem] items-center gap-3 text-sm">
						<span class="text-ink-muted">{s} {s === 1 ? 'star' : 'stars'}</span>
						<span class="h-3 rounded-r-[4px] bg-surface-2" aria-hidden="true">
							<span
								class="block h-3 rounded-r-[4px] bg-brand"
								style="width: {(c / distMax) * 100}%"
							></span>
						</span>
						<span class="text-right font-mono text-xs tabular-nums text-ink">
							{n.format(c)} <span class="text-ink-muted">· {pct(c)}%</span>
						</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section class="mt-10">
		<h2 class="text-sm font-semibold text-ink">By hotel</h2>
		<p class="mt-1 text-xs text-ink-muted">
			Ranked by average rating. Hotels with fewer than {MIN_REVIEWS_FOR_RANK} approved reviews are listed after
			the ranked ones, unrated hotels last.
		</p>
		{#if report.hotels.length === 0}
			<p class="mt-3 text-sm text-ink-muted">No hotels yet.</p>
		{:else}
			<Table.Root class="mt-2">
				<Table.Header>
					<Table.Row>
						<Table.Head class="w-10">#</Table.Head>
						<Table.Head>Hotel</Table.Head>
						<Table.Head class="text-right">Average</Table.Head>
						<Table.Head class="text-right">Reviews</Table.Head>
						{#each STARS as s (s)}
							<Table.Head class="text-right" title="{s}-star reviews">{s}★</Table.Head>
						{/each}
						<Table.Head class="text-right">Awaiting approval</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each report.hotels as h (h.id)}
						<Table.Row>
							<Table.Cell class="font-mono text-xs tabular-nums text-ink-muted">{rankOf.get(h.id) ?? '—'}</Table.Cell>
							<Table.Cell>
								<a class="font-medium text-brand hover:underline" href="/city/hotels/{h.id}">{h.name}</a>
								{#if h.fewReviews}
									<Badge variant="outline" class="ml-2 border-border bg-surface text-ink-muted">Few reviews</Badge>
								{/if}
							</Table.Cell>
							<Table.Cell class="text-right font-mono text-xs font-medium tabular-nums text-ink">
								{h.avg !== null ? h.avg.toFixed(1) : 'Not yet rated'}
							</Table.Cell>
							<Table.Cell class="text-right font-mono text-xs tabular-nums">{h.count || '—'}</Table.Cell>
							{#each STARS as s (s)}
								<Table.Cell class="text-right font-mono text-xs tabular-nums text-ink-muted">
									{h.distribution[s - 1] || '—'}
								</Table.Cell>
							{/each}
							<Table.Cell class="text-right text-xs">
								{#if h.pending > 0}
									<span class="font-mono tabular-nums text-ink">{h.pending}</span>
									{#if h.oldestPending}
										<span class="block text-ink-muted">oldest {fmtDay(h.oldestPending)}</span>
									{/if}
								{:else}
									<span class="text-ink-muted">—</span>
								{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
				<Table.Footer>
					<Table.Row>
						<Table.Cell></Table.Cell>
						<Table.Cell class="font-medium">All hotels</Table.Cell>
						<Table.Cell class="text-right font-mono text-xs font-semibold tabular-nums">
							{report.totals.avg?.toFixed(1) ?? '—'}
						</Table.Cell>
						<Table.Cell class="text-right font-mono text-xs tabular-nums">{n.format(report.totals.count)}</Table.Cell>
						{#each STARS as s (s)}
							<Table.Cell class="text-right font-mono text-xs tabular-nums text-ink-muted">
								{report.totals.distribution[s - 1] || '—'}
							</Table.Cell>
						{/each}
						<Table.Cell class="text-right font-mono text-xs tabular-nums">{n.format(report.totals.pending)}</Table.Cell>
					</Table.Row>
				</Table.Footer>
			</Table.Root>
		{/if}
	</section>

	{#if data.latest.length > 0}
		<section class="mt-10">
			<h2 class="text-sm font-semibold text-ink">Latest approved reviews</h2>
			<ul class="mt-2 divide-y divide-border border-y border-border">
				{#each data.latest as r (r.id)}
					<li class="py-3 text-sm">
						<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
							<span>
								<a class="font-medium text-brand hover:underline" href="/city/hotels/{r.hotelId}">{r.hotelName}</a>
								<span class="ml-2 font-mono text-xs tabular-nums text-ink">{r.rating}/5</span>
							</span>
							<span class="text-xs text-ink-muted">{r.guest} · {fmtDay(r.day)}</span>
						</div>
						<p class="mt-1 line-clamp-2 max-w-[75ch] text-ink-muted">{r.comment}</p>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<p class="mt-6 max-w-[68ch] text-xs leading-relaxed text-ink-muted">
		A rating is the average of guest reviews that the hotel's own staff have approved, on a scale of 1 to
		5, so it matches the public hotel register. “Awaiting approval” counts reviews pending right now,
		whatever the period; the city cannot approve or reject them, the hotel does.
	</p>
</div>
