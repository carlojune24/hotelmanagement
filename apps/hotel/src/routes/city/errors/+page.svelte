<script lang="ts">
	import { goto } from '$app/navigation';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import SearchIcon from '@lucide/svelte/icons/search';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let search = $state('');

	function hrefFor(change: Partial<{ hotel: string; route: string; page: number }>): string {
		const params = new URLSearchParams();
		const hotelId = change.hotel !== undefined ? change.hotel : data.hotelId;
		const routeId = change.route !== undefined ? change.route : data.routeId;
		const page = change.page !== undefined ? change.page : data.page;
		if (hotelId) params.set('hotel', hotelId);
		if (routeId) params.set('route', routeId);
		if (page > 1) params.set('page', String(page));
		const qs = params.toString();
		return `/city/errors${qs ? `?${qs}` : ''}`;
	}

	function onSearchSubmit(e: SubmitEvent) {
		e.preventDefault();
		const ref = search.trim();
		if (!ref) return;
		goto(`/city/errors?ref=${encodeURIComponent(ref)}`);
	}

	const relativeTime = (d: Date | string) => {
		const then = new Date(d).getTime();
		const diffMs = Date.now() - then;
		const mins = Math.round(diffMs / 60_000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.round(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.round(hours / 24);
		return `${days}d ago`;
	};

	const firstRow = $derived(data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1);
	const lastRow = $derived(Math.min(data.page * data.pageSize, data.total));
	const hasPrev = $derived(data.page > 1);
	const hasNext = $derived(lastRow < data.total);
</script>

<div class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
	<div class="mb-6">
		<h1 class="text-xl font-semibold tracking-tight text-ink">Errors</h1>
		<p class="text-sm text-ink-muted">Server-side failures, most recent first.</p>
	</div>

	{#if data.refNotFound}
		<div
			class="mb-4 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger"
		>
			<TriangleAlertIcon class="size-4 shrink-0" />
			No error found for reference <code class="font-mono">{data.refNotFound}</code>.
		</div>
	{/if}

	<div class="mb-4 flex flex-wrap items-center gap-3">
		<form onsubmit={onSearchSubmit} class="relative min-w-56 flex-1">
			<SearchIcon class="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" />
			<Input
				type="search"
				placeholder="Look up a reference code (e.g. 01B32ACA)…"
				aria-label="Look up error by reference"
				bind:value={search}
				class="pl-8 font-mono"
			/>
		</form>
		<Select.Root
			type="single"
			value={data.hotelId ?? ''}
			onValueChange={(v) => goto(hrefFor({ hotel: v || '', page: 1 }))}
		>
			<Select.Trigger class="w-44 shrink-0">
				{data.hotelId
					? (data.hotels.find((h) => h.id === data.hotelId)?.name ?? 'Hotel')
					: 'All hotels'}
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="" label="All hotels" />
				{#each data.hotels as h (h.id)}
					<Select.Item value={h.id} label={h.name} />
				{/each}
			</Select.Content>
		</Select.Root>
		<Select.Root
			type="single"
			value={data.routeId ?? ''}
			onValueChange={(v) => goto(hrefFor({ route: v || '', page: 1 }))}
		>
			<Select.Trigger class="w-56 shrink-0">
				{data.routeId ?? 'All routes'}
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="" label="All routes" />
				{#each data.routes as r (r)}
					<Select.Item value={r} label={r} />
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	<div class="overflow-hidden rounded-xl border border-border">
		{#if data.groups.length === 0}
			<div class="flex flex-col items-center gap-2 p-10 text-center">
				<p class="text-sm text-ink-muted">No errors logged.</p>
			</div>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Ref</Table.Head>
						<Table.Head>Message</Table.Head>
						<Table.Head>Route</Table.Head>
						<Table.Head>Hotel</Table.Head>
						<Table.Head>Last seen</Table.Head>
						<Table.Head class="text-right">Count</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.groups as g (g.latestRef)}
						{@const recent = Date.now() - new Date(g.lastSeen).getTime() < 24 * 60 * 60 * 1000}
						<Table.Row
							class="cursor-pointer"
							onclick={() => goto(`/city/errors/${g.latestRef}`)}
						>
							<Table.Cell class="align-top">
								<a
									href="/city/errors/{g.latestRef}"
									onclick={(e) => e.stopPropagation()}
									class="font-mono text-xs font-medium text-brand hover:underline"
								>
									{g.latestRef}
								</a>
							</Table.Cell>
							<Table.Cell class="max-w-md align-top">
								<p class="truncate text-ink" title={g.message}>{g.message}</p>
							</Table.Cell>
							<Table.Cell class="align-top text-xs text-ink-muted">
								{g.routeId ?? '—'}
							</Table.Cell>
							<Table.Cell class="align-top text-xs text-ink-muted">
								{g.hotelName ?? '—'}
							</Table.Cell>
							<Table.Cell class="align-top text-xs whitespace-nowrap text-ink-muted">
								{relativeTime(g.lastSeen)}
							</Table.Cell>
							<Table.Cell class="text-right align-top">
								{#if g.occurrences > 1}
									<Badge
										variant="outline"
										class={recent
											? 'border-transparent bg-danger/15 text-danger'
											: 'border-border bg-surface text-ink-muted'}
									>
										×{g.occurrences}
									</Badge>
								{:else}
									<span class="text-xs text-ink-muted">1</span>
								{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</div>

	{#if data.total > 0}
		<div class="mt-3 flex items-center justify-between gap-3 text-sm">
			<span class="text-ink-muted tabular-nums">{firstRow}–{lastRow} of {data.total}</span>
			<div class="flex gap-2">
				<Button
					variant="outline"
					size="sm"
					href={hasPrev ? hrefFor({ page: data.page - 1 }) : undefined}
					disabled={!hasPrev}
					aria-label="Previous page">‹ Prev</Button
				>
				<Button
					variant="outline"
					size="sm"
					href={hasNext ? hrefFor({ page: data.page + 1 }) : undefined}
					disabled={!hasNext}
					aria-label="Next page">Next ›</Button
				>
			</div>
		</div>
	{/if}
</div>
