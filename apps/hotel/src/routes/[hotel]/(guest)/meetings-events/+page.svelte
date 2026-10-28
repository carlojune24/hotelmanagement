<script lang="ts">
	import StorefrontNav from '$lib/components/storefront/storefront-nav.svelte';
	import StorefrontFooter from '$lib/components/storefront/storefront-footer.svelte';
	import StorefrontLightbox from '$lib/components/storefront/storefront-lightbox.svelte';
	import UsersIcon from '@lucide/svelte/icons/users';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const peso = (centavos: number) =>
		`₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

	// One shared lightbox instance for the page — each hall loads its own photo set in on click, so
	// browsing never crosses from one hall's photos into another's.
	let lightboxImages = $state<string[]>([]);
	let lightboxIndex = $state<number | null>(null);
	function openLightbox(images: string[], index: number) {
		lightboxImages = images;
		lightboxIndex = index;
	}
	function hidePhoto(e: Event) {
		(e.currentTarget as HTMLImageElement).style.display = 'none';
	}
</script>

<StorefrontNav
	hotelSlug={data.hotel.slug}
	hotelName={data.hotel.name}
	logoUrl={data.branding.logoUrl}
	showAmenities={data.hotelAmenities.length > 0}
	showFunctionHall={data.functionHalls.length > 0}
	showDining={data.diningItems.length > 0 || (data.dining.menuImages ?? []).length > 0}
	showReviews={data.reviews.length > 0}
	accent={data.theme.accent}
	accentDeep={data.theme.accentDeep}
	paper={data.theme.paper}
	paperDeep={data.theme.paperDeep}
/>

<main>
	<header class="sf-page-head">
		<div class="sf-wrap">
			<h1>Meetings &amp; events</h1>
			<p class="sf-lede">Weddings, seminars and celebrations at {data.hotel.name}.</p>
		</div>
	</header>

	{#if data.functionHalls.length === 0}
		<section class="sf-section"><div class="sf-wrap"><p class="sf-lede">No event spaces are set up yet — check back shortly.</p></div></section>
	{:else}
		{#each data.functionHalls as hall, i (hall.id)}
			{@const mainPhoto = hall.photos[0] ?? null}
			{@const restPhotos = hall.photos.slice(1)}
			{@const urls = hall.photos.map((p) => p.url)}
			<section id="hall-{hall.id}" class="sf-venue">
				<div class="sf-wrap">
					<div class="sf-venue-grid" class:is-flip={i % 2 === 1}>
						<div class="sf-venue-gallery">
							{#if mainPhoto}
								<button type="button" class="sf-venue-main" onclick={() => openLightbox(urls, 0)} aria-label="View {hall.name} photos larger">
									<img src={mainPhoto.url} alt="" onerror={hidePhoto} />
								</button>
								{#if restPhotos.length > 0}
									<div class="sf-venue-thumbs">
										{#each restPhotos.slice(0, 4) as photo, j (photo.url)}
											<button type="button" onclick={() => openLightbox(urls, j + 1)} aria-label="View photo {j + 2} larger">
												<img src={photo.url} alt="" loading="lazy" onerror={hidePhoto} />
											</button>
										{/each}
									</div>
								{/if}
							{:else}
								<div class="sf-venue-main" aria-hidden="true"></div>
							{/if}
						</div>

						<div class="sf-venue-info">
							<h2>{hall.name}</h2>
							<div class="sf-hall-price" style="margin-top: 0.75rem">
								<span>From</span>
								<b>{peso(hall.basePriceCentavos)}</b>
								<span>/ {hall.baseHours}h · then {peso(hall.extraHourFeeCentavos)}/hr</span>
							</div>
							{#if hall.description}<p class="sf-venue-desc">{hall.description}</p>{/if}

							<div class="sf-chips" style="margin-top: 1.25rem">
								<span class="sf-chip-static"><UsersIcon aria-hidden="true" />Up to {hall.capacity} guests</span>
							</div>

							{#if hall.includedServices.length > 0}
								<h3 class="sf-prose-h">Included</h3>
								<ul class="sf-venue-points">
									{#each hall.includedServices as s (s)}
										<li><CircleCheckIcon aria-hidden="true" /><span>{s}</span></li>
									{/each}
								</ul>
							{/if}
							{#if hall.supportedEventTypes.length > 0}
								<h3 class="sf-prose-h">Suited for</h3>
								<p class="text-[var(--ledger-ink-muted)]">{hall.supportedEventTypes.join(', ')}</p>
							{/if}

							<div class="sf-feature-actions">
								<a href="/{data.hotel.slug}#function-hall" class="sf-btn">Check date &amp; price</a>
							</div>
						</div>
					</div>
				</div>
			</section>
		{/each}
	{/if}
</main>

<StorefrontLightbox images={lightboxImages} bind:index={lightboxIndex} />

<StorefrontFooter
	hotelSlug={data.hotel.slug}
	hotelName={data.hotel.name}
	city={data.hotel.city}
	showAmenities={data.hotelAmenities.length > 0}
	showFunctionHall={data.functionHalls.length > 0}
	showDining={data.diningItems.length > 0 || (data.dining.menuImages ?? []).length > 0}
	showReviews={data.reviews.length > 0}
	facebookUrl={data.branding.facebookUrl}
	instagramUrl={data.branding.instagramUrl}
	tiktokUrl={data.branding.tiktokUrl}
	phone={data.branding.contactPhone}
	email={data.branding.contactEmail}
	address={data.branding.contactAddress}
/>
