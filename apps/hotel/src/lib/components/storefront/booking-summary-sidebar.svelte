<script lang="ts">
	import { page } from '$app/state';
	import type { CartStore } from '$lib/cart.svelte';
	import { itemLabel, itemDetail } from '$lib/cart-display';

	let { cart, hotelSlug }: { cart: CartStore; hotelSlug: string } = $props();

	const peso = (centavos: number) =>
		`₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

	const checkIn = $derived(page.url.searchParams.get('checkIn'));
	const checkOut = $derived(page.url.searchParams.get('checkOut'));
	const adults = $derived(page.url.searchParams.get('adults') ?? '2');
	const children = $derived(page.url.searchParams.get('children') ?? '0');
	const promo = $derived(page.url.searchParams.get('promo'));

	/** Editing dates/guests routes back to the Dates step, pre-filled with whatever's known
	    right now — the only place occupancy can be corrected once past the Dates step, since
	    `/book/rooms` itself collects room count per card, not occupancy. */
	const editDatesHref = $derived(
		`/${hotelSlug}/book/dates?${new URLSearchParams({
			...(checkIn ? { checkIn } : {}),
			...(checkOut ? { checkOut } : {}),
			adults,
			children
		}).toString()}`
	);
</script>

<aside class="storefront-summary-sidebar">
	<div class="ledger-label mb-2">Booking summary</div>

	{#if checkIn && checkOut}
		<div class="storefront-summary-row">
			<span class="ledger-label">Date</span>
			<span class="ledger-data text-sm">{checkIn} → {checkOut}</span>
			<a href={editDatesHref} class="storefront-summary-edit">Edit</a>
		</div>
		<div class="storefront-summary-row">
			<span class="ledger-label">Guests</span>
			<span class="ledger-data text-sm"
				>{adults} adult{adults === '1' ? '' : 's'}{children !== '0'
					? `, ${children} child${children === '1' ? '' : 'ren'}`
					: ''}</span
			>
			<a href={editDatesHref} class="storefront-summary-edit">Edit</a>
		</div>
	{/if}
	<div class="storefront-summary-row">
		<span class="ledger-label">Special code</span>
		<span class="ledger-data text-sm">{promo || 'None'}</span>
	</div>

	{#if cart.items.length > 0}
		<ul class="storefront-summary-items">
			{#each cart.items as item (item.id)}
				<li class="storefront-summary-item">
					<div class="min-w-0 flex-1">
						<div class="truncate text-sm font-medium text-[var(--ledger-ink)]">
							{itemLabel(item)}
						</div>
						<div class="truncate text-xs text-[var(--ledger-ink-muted)]">{itemDetail(item)}</div>
					</div>
					<div class="flex items-center gap-2">
						<span class="ledger-data text-sm">{peso(item.price.totalCentavos)}</span>
						<button
							type="button"
							class="storefront-summary-remove"
							onclick={() => cart.remove(item.id)}
							aria-label="Remove {itemLabel(item)}"
						>
							✕
						</button>
					</div>
				</li>
			{/each}
		</ul>
		<div class="storefront-summary-total">
			<span>Total</span>
			<span class="ledger-data text-base">{peso(cart.totalCentavos)}</span>
		</div>
		{#if page.route.id === '/[hotel]/book/rooms'}
			<!-- Guest Info and Review each already have their own primary action ("Continue to
			     review", "Pay ₱X") — a second Continue here would be redundant/confusing. -->
			<a href="/{hotelSlug}/book/details" class="ledger-btn-primary storefront-summary-cta">
				Continue
			</a>
		{/if}
	{:else}
		<p class="storefront-summary-empty">
			Nothing added yet — pick a room below to build your invoice.
		</p>
	{/if}
</aside>
