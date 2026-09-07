<script lang="ts">
	import type { CartStore } from '$lib/cart.svelte';
	import { itemLabel, itemDetail } from '$lib/cart-display';

	let { cart, hotelSlug, visible }: { cart: CartStore; hotelSlug: string; visible: boolean } =
		$props();

	let open = $state(false);

	const peso = (centavos: number) =>
		`₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
</script>

{#if visible && cart.items.length > 0}
	<div class="storefront-invoice" class:is-open={open}>
		{#if open}
			<div class="storefront-invoice-panel">
				<div class="storefront-invoice-header">
					<span class="ledger-display text-base">Your invoice</span>
					<button
						type="button"
						class="storefront-invoice-close"
						onclick={() => (open = false)}
						aria-label="Collapse invoice"
					>
						✕
					</button>
				</div>
				<ul class="storefront-invoice-items">
					{#each cart.items as item (item.id)}
						<li class="storefront-invoice-item">
							<div class="min-w-0 flex-1">
								<div class="truncate text-sm font-medium text-[var(--ledger-ink)]">
									{itemLabel(item)}
								</div>
								<div class="truncate text-xs text-[var(--ledger-ink-muted)]">
									{itemDetail(item)}
								</div>
							</div>
							<div class="flex items-center gap-2">
								<span class="ledger-data text-sm">{peso(item.price.totalCentavos)}</span>
								<button
									type="button"
									class="storefront-invoice-remove"
									onclick={() => cart.remove(item.id)}
									aria-label="Remove {itemLabel(item)}"
								>
									✕
								</button>
							</div>
						</li>
					{/each}
				</ul>
				<div class="storefront-invoice-total">
					<span>Total</span>
					<span class="ledger-data text-base">{peso(cart.totalCentavos)}</span>
				</div>
				<a href="/{hotelSlug}/book/details" class="ledger-btn-primary storefront-invoice-cta">
					Proceed to checkout
				</a>
			</div>
		{:else}
			<button type="button" class="storefront-invoice-pill" onclick={() => (open = true)}>
				<span class="storefront-invoice-count">{cart.items.length}</span>
				<span class="ledger-data">{peso(cart.totalCentavos)}</span>
			</button>
		{/if}
	</div>
{/if}
