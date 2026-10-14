<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import SearchIcon from '@lucide/svelte/icons/search';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { KIND_LABEL } from '$lib/lookup-labels';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let expanded = $state<Set<string>>(new Set());
	function toggle(id: string) {
		const next = new Set(expanded);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		expanded = next;
	}

	const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
	// "booking.check_in" → "Check in": enough to read the trail without a translation table.
	const humanize = (action: string) => {
		const last = action.split('.').pop() ?? action;
		const s = last.replace(/_/g, ' ');
		return s.charAt(0).toUpperCase() + s.slice(1);
	};
</script>

<div class="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6">
	<div>
		<h1 class="text-xl font-semibold tracking-tight text-ink">Find by number</h1>
		<p class="mt-0.5 text-sm text-ink-muted">
			Type a booking code, an order (DN-…) or table reservation (TB-…) code, an OR or invoice
			number, or a payment or deposit reference.
		</p>
	</div>

	<form method="GET" class="flex items-center gap-2" role="search">
		<Input
			name="q"
			value={data.q}
			placeholder="e.g. 1A2B3C4D, DN-YBCV, OR-000042"
			class="h-10 max-w-sm"
			aria-label="Number to find"
			autocomplete="off"
			autofocus
		/>
		<Button type="submit"><SearchIcon class="size-4" aria-hidden="true" /> Find</Button>
	</form>

	{#if data.q && data.hits.length === 0}
		<p class="rounded-xl border border-dashed border-border p-8 text-center text-sm text-ink-muted">
			Nothing found for “{data.q}”. Check the number, or that you have access to what it belongs to.
		</p>
	{/if}

	{#if data.hits.length > 0}
		<ul class="divide-y divide-border overflow-hidden rounded-xl border border-border">
			{#each data.hits as h (h.key)}
				<li class="flex flex-wrap items-center gap-3 px-4 py-3">
					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-center gap-2">
							<span class="font-medium text-ink">{h.title}</span>
							<Badge variant="outline" class="text-xs">{KIND_LABEL[h.kind]}</Badge>
						</div>
						<p class="mt-0.5 text-sm text-ink-muted">{h.subtitle}</p>
					</div>
					<Button size="sm" variant="outline" href={h.href}>Open</Button>
				</li>
			{/each}
		</ul>

		<section aria-labelledby="trail-h">
			<h2 id="trail-h" class="mb-2 text-sm font-semibold text-ink">Activity</h2>
			{#if data.trail.length === 0}
				<p class="text-sm text-ink-muted">Nothing has been recorded against this yet.</p>
			{:else}
				<div class="overflow-hidden rounded-xl border border-border">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>When</Table.Head>
								<Table.Head>Who</Table.Head>
								<Table.Head>What</Table.Head>
								{#if data.canSeeDetails}<Table.Head class="w-10"><span class="sr-only">Details</span></Table.Head>{/if}
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each data.trail as e (e.id)}
								<Table.Row>
									<Table.Cell class="whitespace-nowrap text-xs tabular-nums text-ink-muted">{fmt(e.at)}</Table.Cell>
									<Table.Cell class="text-sm text-ink">{e.actor ?? 'System'}</Table.Cell>
									<Table.Cell class="text-sm text-ink">
										{humanize(e.action)}
										<span class="ml-1 text-xs text-ink-muted">{e.entityType.replace(/_/g, ' ')}</span>
									</Table.Cell>
									{#if data.canSeeDetails}
										<Table.Cell>
											{#if e.before || e.after}
												<button
													type="button"
													class="rounded p-1 text-ink-muted hover:text-ink"
													aria-expanded={expanded.has(e.id)}
													aria-label="Show details"
													onclick={() => toggle(e.id)}
												>
													<ChevronDownIcon class="size-4 transition-transform {expanded.has(e.id) ? 'rotate-180' : ''}" />
												</button>
											{/if}
										</Table.Cell>
									{/if}
								</Table.Row>
								{#if data.canSeeDetails && expanded.has(e.id)}
									<Table.Row>
										<Table.Cell colspan={4} class="bg-surface-2">
											<div class="grid gap-3 text-xs sm:grid-cols-2">
												{#if e.before}
													<div>
														<div class="mb-1 font-medium text-ink-muted">Before</div>
														<pre class="overflow-x-auto whitespace-pre-wrap text-ink">{JSON.stringify(e.before, null, 2)}</pre>
													</div>
												{/if}
												{#if e.after}
													<div>
														<div class="mb-1 font-medium text-ink-muted">After</div>
														<pre class="overflow-x-auto whitespace-pre-wrap text-ink">{JSON.stringify(e.after, null, 2)}</pre>
													</div>
												{/if}
											</div>
										</Table.Cell>
									</Table.Row>
								{/if}
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			{/if}
		</section>
	{/if}
</div>
