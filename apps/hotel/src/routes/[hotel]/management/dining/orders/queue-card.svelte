<script lang="ts">
	import ClockIcon from '@lucide/svelte/icons/clock';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import { ORDER_TYPE_LABEL, formatWaitShort, waitLevel } from '$lib/dining-orders';
	import { minutesSince, paymentLabel } from '$lib/orders-board';
	import TableChip from './table-chip.svelte';
	import type { PageData } from './$types';

	type Order = PageData['orders'][number];

	let { order, nowMs, ondetails }: { order: Order; nowMs: number; ondetails: (order: Order) => void } = $props();

	const minutes = $derived(minutesSince(order.createdAt, nowMs));
	const level = $derived(waitLevel(minutes));
	const late = $derived(level === 'late');
	const unpaid = $derived(order.paymentStatus === 'unpaid');
	const where = $derived(order.tableLabel ? `Table ${order.tableLabel}` : (ORDER_TYPE_LABEL[order.orderType] ?? 'Order'));
</script>

<!-- The whole card opens the order; the kitchen moves it on, so there is nothing else to press here. -->
<button
	type="button"
	onclick={() => ondetails(order)}
	aria-label="{where}, order {order.code}, {formatWaitShort(minutes)}{late ? ', late' : ''}. Open details"
	class="flex w-full flex-col gap-2.5 rounded-xl border p-3 text-left transition-colors hover:bg-surface-2/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none {late
		? 'border-danger bg-danger/5'
		: 'border-border bg-surface'}"
>
	<span class="flex items-center justify-between gap-2">
		<TableChip label={order.tableLabel} orderType={order.orderType} size="sm" />
		<span
			class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums {late
				? 'bg-danger/10 text-danger'
				: level === 'slow'
					? 'bg-warning/15 text-ink'
					: 'bg-surface-2 text-ink-muted'}"
			title="Time since the order was placed"
		>
			{#if level !== 'ok'}<ClockIcon class="size-3 {late ? '' : 'text-warning'}" aria-hidden="true" />{/if}
			{formatWaitShort(minutes)}{late ? ' · Late' : level === 'slow' ? ' · Slow' : ''}
		</span>
	</span>

	<span class="block min-w-0 space-y-0.5 text-sm text-ink">
		{#each order.items.slice(0, 3) as i (i.id)}
			<span class="block truncate"><span class="tabular-nums text-ink-muted">{i.quantity}×</span> {i.name}</span>
		{/each}
		{#if order.items.length > 3}
			<span class="block text-xs text-ink-muted">+ {order.items.length - 3} more</span>
		{/if}
	</span>

	<span class="flex items-center gap-1.5 text-xs text-ink-muted">
		<span class="font-mono">{order.code}</span>
		{#if order.source === 'online'}<GlobeIcon class="size-3" aria-label="Online order" />{/if}
		<span aria-hidden="true">·</span>
		<span class={unpaid ? 'font-semibold text-danger' : ''}>{paymentLabel(order, false)}</span>
	</span>
</button>
