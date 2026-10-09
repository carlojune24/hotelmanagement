<script lang="ts">
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { ORDER_STATUS_LABEL, ORDER_TYPE_LABEL } from '$lib/dining-orders';
	import OrderCard from './order-card.svelte';
	import type { ComponentProps } from 'svelte';
	import type { PageData } from './$types';

	type Order = PageData['orders'][number];
	type Handlers = Pick<
		ComponentProps<typeof OrderCard>,
		'onadvance' | 'onpay' | 'oncancel' | 'onvoid' | 'oninvoice' | 'onissuereceipt' | 'ontalk' | 'onrespond' | 'onundoroom'
	>;

	let {
		open = $bindable(false),
		order,
		nowMs,
		slug,
		timezone,
		canWrite,
		canVoid,
		...handlers
	}: {
		open: boolean;
		order: Order | null;
		nowMs: number;
		slug: string;
		timezone: string;
		canWrite: boolean;
		canVoid: boolean;
	} & Handlers = $props();

	// Every action opens its own dialog or sheet, so leave this one first rather than stacking modals.
	const leave =
		<A extends unknown[]>(fn: (...a: A) => void) =>
		(...a: A) => {
			open = false;
			fn(...a);
		};
</script>

<Sheet.Root bind:open>
	<Sheet.Content side="right" class="flex w-full flex-col gap-0 p-0 sm:max-w-md">
		<Sheet.Header class="border-b border-border px-5 py-4">
			<Sheet.Title>{order ? `Order ${order.code}` : 'Order'}</Sheet.Title>
			<Sheet.Description>
				{#if order}
					{order.tableLabel ? `Table ${order.tableLabel}` : (ORDER_TYPE_LABEL[order.orderType] ?? 'Order')} · {ORDER_STATUS_LABEL[order.status as keyof typeof ORDER_STATUS_LABEL] ?? order.status}
				{/if}
			</Sheet.Description>
		</Sheet.Header>
		<div class="min-h-0 flex-1 overflow-y-auto p-4">
			{#if order}
				<OrderCard
					{order}
					{nowMs}
					{slug}
					{timezone}
					{canWrite}
					{canVoid}
					onadvance={leave(handlers.onadvance)}
					onpay={leave(handlers.onpay)}
					oncancel={leave(handlers.oncancel)}
					onvoid={leave(handlers.onvoid)}
					oninvoice={leave(handlers.oninvoice)}
					onissuereceipt={leave(handlers.onissuereceipt)}
					ontalk={leave(handlers.ontalk)}
					onrespond={leave(handlers.onrespond)}
					onundoroom={leave(handlers.onundoroom)}
				/>
			{:else}
				<p class="text-sm text-ink-muted">This order is no longer on the board.</p>
			{/if}
		</div>
	</Sheet.Content>
</Sheet.Root>
