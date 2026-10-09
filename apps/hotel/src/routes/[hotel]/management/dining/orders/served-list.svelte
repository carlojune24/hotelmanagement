<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { ORDER_TYPE_LABEL, formatWaitShort } from '$lib/dining-orders';
	import { itemsLine, minutesSince } from '$lib/orders-board';
	import PayPill from './pay-pill.svelte';
	import type { PageData } from './$types';

	type Order = PageData['orders'][number];

	let {
		orders,
		nowMs,
		ondetails
	}: { orders: Order[]; nowMs: number; ondetails: (order: Order) => void } = $props();

	const PREVIEW = 3;
	let expanded = $state(false);
	const shown = $derived(expanded ? orders : orders.slice(0, PREVIEW));
	const where = (o: Order) => (o.tableLabel ? `Table ${o.tableLabel}` : (ORDER_TYPE_LABEL[o.orderType] ?? 'Order'));
</script>

<section class="rounded-xl border border-border bg-surface" aria-labelledby="served-heading">
	<h2 id="served-heading" class="flex items-center justify-between px-4 py-3 text-sm font-semibold text-ink">
		Served today
		<span class="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold tabular-nums text-ink-muted">{orders.length}</span>
	</h2>

	{#if orders.length === 0}
		<p class="border-t border-border px-4 py-6 text-center text-sm text-ink-muted">Nothing served yet today.</p>
	{:else}
		<ul class="divide-y divide-border border-t border-border {expanded ? 'max-h-[28rem] overflow-y-auto overscroll-contain' : ''}">
			{#each shown as o (o.id)}
				<li>
					<button
						type="button"
						onclick={() => ondetails(o)}
						aria-label="{where(o)}, order {o.code}, served. Open details"
						class="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2/60 focus-visible:bg-surface-2 focus-visible:outline-none"
					>
						<span class="min-w-0">
							<span class="block truncate text-sm font-semibold text-ink">{where(o)} · {o.code}</span>
							<span class="block truncate text-xs text-ink-muted">{itemsLine(o.items)}</span>
						</span>
						<span class="flex shrink-0 flex-col items-end gap-1">
							<span class="text-xs tabular-nums text-ink-muted">{formatWaitShort(minutesSince(o.servedAt, nowMs))} ago</span>
							<PayPill order={o} withMethod={false} />
						</span>
					</button>
				</li>
			{/each}
		</ul>
		{#if orders.length > PREVIEW}
			<div class="border-t border-border p-1.5">
				<Button variant="ghost" class="h-10 w-full text-brand" aria-expanded={expanded} onclick={() => (expanded = !expanded)}>
					{expanded ? 'Show fewer' : `View all ${orders.length}`}
				</Button>
			</div>
		{/if}
	{/if}
</section>
