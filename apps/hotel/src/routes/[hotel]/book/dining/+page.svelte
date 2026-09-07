<script lang="ts">
	import StorefrontNav from '$lib/components/storefront/storefront-nav.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const menuImages = $derived(data.dining.menuImages ?? []);

	let lightboxSrc = $state<string | null>(null);
	function hidePhoto(e: Event) {
		(e.currentTarget as HTMLImageElement).style.display = 'none';
	}
</script>

<svelte:head>
	<title>Dining — {data.hotel.name}</title>
</svelte:head>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') lightboxSrc = null;
	}}
/>

<StorefrontNav
	hotelSlug={data.hotel.slug}
	hotelName={data.hotel.name}
	logoUrl={data.branding.logoUrl}
	showAmenities={data.hotelAmenities.length > 0}
	showFunctionHall={data.functionHalls.length > 0}
	showDining={true}
	showReviews={data.reviews.length > 0}
/>

<div class="storefront-section mx-auto max-w-4xl px-4 py-10 sm:px-6">
	<h1 class="storefront-section-title ledger-display text-3xl sm:text-4xl">
		Dining at {data.hotel.name}
	</h1>
	<p class="storefront-section-lede mt-2">Restaurants, bars, and cafés on the property.</p>

	{#if data.diningItems.length === 0}
		<p class="storefront-section-lede mt-8">Dining information is coming soon.</p>
	{:else}
		{#each data.diningItems as item, i (item.id)}
			<section class="mt-12 {i > 0 ? 'border-t border-[var(--ledger-rule)] pt-12' : ''}">
				<h2 class="ledger-display text-2xl">{item.title}</h2>

				{#if item.photoUrl}
					<div class="storefront-room-dialog-gallery mt-6">
						<button
							type="button"
							class="storefront-room-dialog-photo-main"
							onclick={() => (lightboxSrc = item.photoUrl)}
							aria-label="View larger photo"
						>
							<img src={item.photoUrl} alt="" onerror={hidePhoto} />
						</button>
					</div>
				{/if}

				{#if item.description}
					<p class="storefront-room-dialog-desc mt-6 whitespace-pre-line">{item.description}</p>
				{/if}

				{#if item.operatingHours}
					<div class="storefront-glance-row mt-6">
						<span class="storefront-room-dialog-spec-chip">
							<span>{item.operatingHours}</span>
						</span>
					</div>
				{/if}
			</section>
		{/each}
	{/if}

	{#if menuImages.length > 0}
		<div class="mt-12 border-t border-[var(--ledger-rule)] pt-12">
			<h2 class="ledger-display text-2xl">Menus</h2>
			<div class="storefront-gallery-grid mt-6">
				{#each menuImages as url, i (url)}
					<button
						type="button"
						class="storefront-gallery-item {i % 5 === 0 ? 'is-wide' : ''}"
						onclick={() => (lightboxSrc = url)}
						aria-label="View larger photo"
					>
						<img src={url} alt="" loading="lazy" onerror={hidePhoto} />
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>

{#if lightboxSrc}
	<div
		class="storefront-lightbox"
		role="button"
		tabindex="0"
		aria-label="Close photo"
		onclick={() => (lightboxSrc = null)}
		onkeydown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') lightboxSrc = null;
		}}
	>
		<img src={lightboxSrc} alt="" onerror={hidePhoto} />
		<button type="button" class="storefront-lightbox-close" onclick={() => (lightboxSrc = null)}>
			Close ✕
		</button>
	</div>
{/if}
