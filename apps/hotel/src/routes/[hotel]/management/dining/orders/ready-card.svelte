<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import { ORDER_TYPE_LABEL, formatWaitShort } from '$lib/dining-orders';
	import { readyMinutes } from '$lib/orders-board';
	import PayPill from './pay-pill.svelte';
	import TableChip from './table-chip.svelte';
	import type { PageData } from './$types';

	type Order = PageData['orders'][number];

	let {
		order,
		nowMs,
		canWrite,
		busy = false,
		onserve,
		onpay,
		ondetails
	}: {
		order: Order;
		nowMs: number;
		canWrite: boolean;
		/** True while this order's "served" request is in flight. */
		busy?: boolean;
		onserve: (order: Order) => void;
		onpay: (order: Order) => void;
		ondetails: (order: Order) => void;
	} = $props();

	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

	const waiting = $derived(readyMinutes(order, nowMs));
	// Food left at the pass goes cold: the number turns amber after 3 minutes, same rule as the Kitchen board.
	const cold = $derived(waiting >= 3);
	const unpaid = $derived(order.paymentStatus === 'unpaid');
	const title = $derived(order.tableLabel ? `Table ${order.tableLabel}` : (ORDER_TYPE_LABEL[order.orderType] ?? 'Order'));
</script>

<article class="flex flex-col rounded-xl border-2 border-ok bg-surface p-4" aria-label="Order {order.code}, ready to serve">
	<header class="flex items-start gap-3">
		<TableChip label={order.tableLabel} orderType={order.orderType} tone="ok" />
		<div class="min-w-0 flex-1">
			<p class="truncate font-semibold text-ink">{title}</p>
			<p class="flex items-center gap-1.5 truncate text-xs text-ink-muted">
				<span class="font-mono">{order.code}</span>
				{#if order.source === 'online'}<GlobeIcon class="size-3" aria-label="Online order" />{/if}
				{#if order.guestName}<span class="truncate">· {order.guestName}</span>{/if}
			</p>
		</div>
		<p class="shrink-0 text-right" title="Time since the kitchen marked it ready">
			<span class="block text-2xl leading-none font-bold tabular-nums {cold ? 'text-warning' : 'text-ok'}">{formatWaitShort(waiting)}</span>
			<span class="text-xs text-ink-muted">waiting</span>
		</p>
	</header>

	<ul class="mt-4 space-y-0.5 text-sm text-ink">
		{#each order.items as i (i.id)}
			<li><span class="tabular-nums text-ink-muted">{i.quantity}×</span> {i.name}</li>
		{/each}
	</ul>
	{#if order.remarks}<p class="mt-2 line-clamp-2 text-xs text-ink-muted italic">“{order.remarks}”</p>{/if}

	<div class="mt-auto flex items-center justify-between gap-2 pt-4">
		<span class="text-lg font-semibold tabular-nums text-ink">{peso(order.totalCentavos)}</span>
		<PayPill {order} />
	</div>

	<div class="mt-3 flex items-center gap-2">
		{#if canWrite}
			<Button class="h-11 flex-1" disabled={busy} onclick={() => onserve(order)}>{busy ? 'Marking…' : 'Mark served'}</Button>
			{#if unpaid}
				<Button variant="outline" class="h-11" onclick={() => onpay(order)}>Take payment</Button>
			{/if}
		{/if}
		<Button
			variant="ghost"
			size="icon"
			class="size-11 shrink-0 {canWrite ? '' : 'ml-auto'}"
			aria-label="Details and more actions for {order.code}"
			onclick={() => ondetails(order)}
		>
			<EllipsisIcon class="size-4" />
		</Button>
	</div>
</article>
