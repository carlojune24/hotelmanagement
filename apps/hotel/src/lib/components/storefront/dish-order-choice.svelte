<script lang="ts" module>
	export type DishChoice = {
		venueId: string;
		dish: { id: string; name: string; priceCentavos: number; imageUrl: string | null; hasAddons: boolean };
		canOrder: boolean;
		canReserve: boolean;
	};
</script>

<script lang="ts">
	import { getContext } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import type { StorefrontTheme } from '$lib/storefront-mode.svelte';
	import ShoppingBagIcon from '@lucide/svelte/icons/shopping-bag';
	import ArmchairIcon from '@lucide/svelte/icons/armchair';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import UtensilsCrossedIcon from '@lucide/svelte/icons/utensils-crossed';

	/**
	 * A tapped dish asks how the guest wants it: ordered online (pickup or delivery) or with a table
	 * (reserve, then it's in the table's pre-order). Either link carries `dish=`, so the dish is already
	 * picked when they land. Only the ways the venue has turned on are offered. Renders through a portal,
	 * so it re-declares the hotel's theme tokens on itself (same as the quick-view sheet).
	 */
	let {
		choice = $bindable(null),
		base,
		themeStyle
	}: { choice: DishChoice | null; base: string; themeStyle: string } = $props();

	const sfTheme = getContext<StorefrontTheme | undefined>('sf-theme');
	const peso = (centavos: number) =>
		`₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	const q = $derived(choice ? `venue=${choice.venueId}&dish=${choice.dish.id}` : '');
</script>

<Dialog.Root open={choice !== null} onOpenChange={(o) => !o && (choice = null)}>
	<Dialog.Content
		style={themeStyle}
		data-mode={sfTheme?.mode ?? 'light'}
		showCloseButton={false}
		class="woven-ledger sf-dishpick bg-[var(--ledger-paper)] text-[var(--ledger-ink)] ring-[var(--ledger-rule)]"
	>
		{#if choice}
			<div class="sf-dishpick-head">
				{#if choice.dish.imageUrl}
					<img src={choice.dish.imageUrl} alt="" class="sf-dishpick-photo" />
				{:else}
					<span class="sf-dishpick-photo is-empty" aria-hidden="true"><UtensilsCrossedIcon /></span>
				{/if}
				<div class="min-w-0">
					<Dialog.Title class="sf-dishpick-name">{choice.dish.name}</Dialog.Title>
					<p class="sf-dishpick-price">{peso(choice.dish.priceCentavos)}</p>
				</div>
			</div>
			<Dialog.Description class="sf-dishpick-ask">
				How would you like it?{#if choice.dish.hasAddons} You'll pick the size and add-ons next.{/if}
			</Dialog.Description>

			<div class="sf-dishpick-opts">
				{#if choice.canOrder}
					<a href="{base}/dining/order?{q}" class="sf-dishpick-opt">
						<ShoppingBagIcon aria-hidden="true" />
						<span><b>Order online</b><span>Pickup or delivery, paid online.</span></span>
						<ChevronRightIcon aria-hidden="true" />
					</a>
				{/if}
				{#if choice.canReserve}
					<a href="{base}/dining/reserve?{q}" class="sf-dishpick-opt">
						<ArmchairIcon aria-hidden="true" />
						<span><b>Reserve a table</b><span>Book a table; this dish is ready when you arrive.</span></span>
						<ChevronRightIcon aria-hidden="true" />
					</a>
				{/if}
			</div>

			<button type="button" class="sf-link sf-dishpick-close" onclick={() => (choice = null)}>Keep browsing</button>
		{/if}
	</Dialog.Content>
</Dialog.Root>
