<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import StorefrontNav from '$lib/components/storefront/storefront-nav.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const peso = (centavos: number) =>
		`₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

	let lightboxSrc = $state<string | null>(null);
	function hidePhoto(e: Event) {
		(e.currentTarget as HTMLImageElement).style.display = 'none';
	}
</script>

<svelte:head>
	<title>Meetings &amp; Events — {data.hotel.name}</title>
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
	showDining={data.diningItems.length > 0 || (data.dining.menuImages ?? []).length > 0}
	showReviews={data.reviews.length > 0}
/>

<div class="storefront-section mx-auto max-w-4xl px-4 py-10 sm:px-6">
	<h1 class="storefront-section-title ledger-display text-3xl sm:text-4xl">
		Meetings &amp; Events
	</h1>
	<p class="storefront-section-lede mt-2">
		Weddings, seminars, and celebrations at {data.hotel.name}.
	</p>

	{#if data.functionHalls.length === 0}
		<p class="storefront-section-lede mt-8">No event spaces are set up yet — check back shortly.</p>
	{:else}
		{#each data.functionHalls as hall, i (hall.id)}
			{@const mainPhoto = hall.photos[0] ?? null}
			{@const restPhotos = hall.photos.slice(1)}
			<section
				id="hall-{hall.id}"
				class="mt-12 scroll-mt-24 {i > 0 ? 'border-t border-[var(--ledger-rule)] pt-12' : ''}"
			>
				<h2 class="ledger-display text-2xl">{hall.name}</h2>
				<p class="storefront-room-dialog-price mt-1">
					<span class="ledger-data text-lg">{peso(hall.basePriceCentavos)}</span>
					<span class="ledger-label">/ {hall.baseHours}h, from — + {peso(hall.extraHourFeeCentavos)}/hr after</span>
				</p>

				{#if mainPhoto}
					<div class="storefront-room-dialog-gallery mt-6">
						<button
							type="button"
							class="storefront-room-dialog-photo-main"
							onclick={() => (lightboxSrc = mainPhoto.url)}
							aria-label="View larger photo"
						>
							<img src={mainPhoto.url} alt="" onerror={hidePhoto} />
						</button>
						{#if restPhotos.length > 0}
							<div class="storefront-room-dialog-photo-strip">
								{#each restPhotos as photo (photo.url)}
									<button
										type="button"
										class="storefront-room-dialog-photo-thumb"
										onclick={() => (lightboxSrc = photo.url)}
										aria-label="View larger photo"
									>
										<img src={photo.url} alt="" loading="lazy" onerror={hidePhoto} />
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{/if}

				{#if hall.description}
					<p class="storefront-room-dialog-desc mt-6">{hall.description}</p>
				{/if}

				<div class="storefront-glance-row mt-6">
					<span class="storefront-room-dialog-spec-chip">
						<span>Up to {hall.capacity} guests</span>
					</span>
				</div>

				{#if hall.includedServices.length > 0}
					<div class="storefront-room-dialog-amenities mt-6">
						<h3 class="storefront-amenity-group-head">Included</h3>
						<p class="mt-2 text-sm text-[var(--ledger-ink-muted)]">
							{hall.includedServices.join(' · ')}
						</p>
					</div>
				{/if}
				{#if hall.supportedEventTypes.length > 0}
					<div class="mt-4">
						<h3 class="storefront-amenity-group-head">Suited for</h3>
						<p class="mt-2 text-sm text-[var(--ledger-ink-muted)]">
							{hall.supportedEventTypes.join(', ')}
						</p>
					</div>
				{/if}

				<Button href="/{data.hotel.slug}/book#function-hall" class="ledger-btn-primary mt-6">
					Reserve this hall
				</Button>
			</section>
		{/each}
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
