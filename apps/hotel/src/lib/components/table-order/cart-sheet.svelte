<script lang="ts">
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import CartPanel from './cart-panel.svelte';
	import type { TableCart } from '$lib/dining-cart.svelte';

	let {
		open = $bindable(false),
		cart,
		error = null,
		themeVars
	}: {
		open: boolean;
		cart: TableCart;
		error?: string | null;
		/** The hotel's colour variables: a sheet renders in a portal, outside the themed page. */
		themeVars: string;
	} = $props();

	// An empty cart has nothing to show: close rather than leave an empty sheet.
	$effect(() => {
		if (open && cart.lines.length === 0) open = false;
	});
</script>

<Sheet.Root bind:open>
	<Sheet.Content side="bottom" style={themeVars} class="woven-ledger tq-sheet">
		<div class="tq-grab" aria-hidden="true"></div>
		<Sheet.Header class="tq-sheet-head">
			<Sheet.Title class="ledger-display tq-sheet-title">Your order</Sheet.Title>
			<span class="tq-count-pill">{cart.totals.itemCount} {cart.totals.itemCount === 1 ? 'item' : 'items'}</span>
			<Sheet.Description class="sr-only">Review your dishes, then place your order.</Sheet.Description>
		</Sheet.Header>
		<CartPanel {cart} {error} variant="sheet" idPrefix="sheet" onsent={() => (open = false)} />
	</Sheet.Content>
</Sheet.Root>
