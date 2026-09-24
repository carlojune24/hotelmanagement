<script lang="ts">
	import StorefrontNav from '$lib/components/storefront/storefront-nav.svelte';
	import StorefrontFooter from '$lib/components/storefront/storefront-footer.svelte';
	import StorefrontLightbox from '$lib/components/storefront/storefront-lightbox.svelte';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import type { DiningPhoto } from '$lib/server/db/schema/dining';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const menuImages = $derived(data.dining.menuImages ?? []);
	const hasIntro = $derived(Boolean(data.dining.introEyebrow || data.dining.introHeading || data.dining.introBody));

	const venuePhotos = (photos: unknown) => (photos as DiningPhoto[] | null) ?? [];
	const coverPhoto = (photos: unknown) => {
		const list = venuePhotos(photos);
		return list.find((p) => p.tag === 'cover')?.url ?? list[0]?.url ?? null;
	};

	// One shared lightbox instance for the page — a venue's own gallery, the Menus
	// gallery, each load their own set on click.
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

<svelte:head>
	<title>Dining — {data.hotel.name}</title>
</svelte:head>

<StorefrontNav
	hotelSlug={data.hotel.slug}
	hotelName={data.hotel.name}
	logoUrl={data.branding.logoUrl}
	showAmenities={data.hotelAmenities.length > 0}
	showFunctionHall={data.functionHalls.length > 0}
	showDining={true}
	showReviews={data.reviews.length > 0}
	accent={data.theme.accent}
	accentDeep={data.theme.accentDeep}
	paper={data.theme.paper}
	paperDeep={data.theme.paperDeep}
/>

<section class="storefront-section">
	{#if hasIntro}
		<p class="storefront-eyebrow">{data.dining.introEyebrow ?? 'Dining'}</p>
		<h1 class="storefront-section-title ink-heading ledger-display mt-2 text-3xl sm:text-4xl">
			{data.dining.introHeading ?? `Dining at ${data.hotel.name}`}
		</h1>
		{#if data.dining.introBody}
			<p class="storefront-section-lede text-[0.9375rem] leading-relaxed">
				{data.dining.introBody}
			</p>
		{/if}
	{:else}
		<h1 class="storefront-section-title ledger-display text-3xl sm:text-4xl">
			Dining at {data.hotel.name}
		</h1>
		<p class="storefront-section-lede mt-2">Restaurants, bars, and cafés on the property.</p>
	{/if}

	{#if menuImages.length > 0}
		<a href="#menus" class="ledger-btn-primary mt-6 inline-flex">View menu</a>
	{/if}

	{#if data.diningItems.length === 0}
		<p class="storefront-section-lede mt-8">Dining information is coming soon.</p>
	{:else}
		<div class="storefront-room-grid mt-10">
			{#each data.diningItems as item (item.id)}
				{@const cover = coverPhoto(item.photos)}
				<a href="#venue-{item.id}" class="storefront-room-card">
					<div class="storefront-room-card-photo">
						<span class="ledger-room-photo-mark">{item.title.charAt(0)}</span>
						{#if cover}<img src={cover} alt="" onerror={hidePhoto} />{/if}
						<div class="storefront-room-card-scrim"></div>
						<div class="storefront-room-card-overlay">
							<div class="storefront-room-card-name">{item.title}</div>
							<div class="storefront-room-card-rule"></div>
							<div class="storefront-room-card-row">
								<div class="storefront-room-card-glance">
									{#if item.category}
										<span class="storefront-glance-item">{item.category}</span>
									{/if}
								</div>
								<div class="storefront-room-card-cta">
									<span class="storefront-room-card-details">View →</span>
								</div>
							</div>
						</div>
					</div>
				</a>
			{/each}
		</div>

		{#each data.diningItems as item (item.id)}
			{@const photos = venuePhotos(item.photos)}
			{@const highlights = item.highlights as string[]}
			{@const mainPhoto = photos.find((p) => p.tag === 'cover') ?? photos[0] ?? null}
			{@const restPhotos = mainPhoto ? photos.filter((p) => p.url !== mainPhoto.url) : []}
			{@const allPhotoUrls = mainPhoto ? [mainPhoto, ...restPhotos].map((p) => p.url) : []}
			<section id="venue-{item.id}" class="mt-16 scroll-mt-24 border-t border-[var(--ledger-rule)] pt-16">
				{#if item.category}
					<p class="ledger-label">{item.category}</p>
				{/if}
				<h2 class="ledger-display mt-1 text-2xl">{item.title}</h2>
				{#if item.tagline}
					<p class="storefront-room-dialog-desc mt-1 text-[1.0625rem]">{item.tagline}</p>
				{/if}

				{#if mainPhoto}
					<div class="storefront-room-dialog-gallery mt-6">
						<button
							type="button"
							class="storefront-room-dialog-photo-main"
							onclick={() => openLightbox(allPhotoUrls, 0)}
							aria-label="View larger photo"
						>
							<img src={mainPhoto.url} alt="" onerror={hidePhoto} />
						</button>
						{#if restPhotos.length > 0}
							<div class="storefront-room-dialog-photo-strip">
								{#each restPhotos as photo, j (photo.url)}
									<button
										type="button"
										class="storefront-room-dialog-photo-thumb"
										onclick={() => openLightbox(allPhotoUrls, j + 1)}
										aria-label="View larger photo"
									>
										<img src={photo.url} alt="" loading="lazy" onerror={hidePhoto} />
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{/if}

				{#if item.description}
					<p class="storefront-room-dialog-desc mt-6 whitespace-pre-line">{item.description}</p>
				{/if}

				{#if highlights.length > 0}
					<ul class="storefront-amenity-list">
						{#each highlights as h (h)}
							<li class="storefront-amenity-item">
								<CircleCheckIcon aria-hidden="true" />
								<span>{h}</span>
							</li>
						{/each}
					</ul>
				{/if}

				{#if item.operatingHours}
					<div class="storefront-glance-row mt-6">
						<span class="storefront-room-dialog-spec-chip">
							<ClockIcon aria-hidden="true" />
							<span>{item.operatingHours}</span>
						</span>
					</div>
				{/if}
			</section>
		{/each}
	{/if}

	{#if menuImages.length > 0}
		<div id="menus" class="mt-16 scroll-mt-24 border-t border-[var(--ledger-rule)] pt-16">
			<h2 class="ledger-display text-2xl">Menus</h2>
			<div class="storefront-gallery-grid mt-6">
				{#each menuImages as url, i (url)}
					<button
						type="button"
						class="storefront-gallery-item {i % 5 === 0 ? 'is-wide' : ''}"
						onclick={() => openLightbox(menuImages, i)}
						aria-label="View larger photo"
					>
						<img src={url} alt="" loading="lazy" onerror={hidePhoto} />
					</button>
				{/each}
			</div>
		</div>
	{/if}
</section>

<StorefrontLightbox images={lightboxImages} bind:index={lightboxIndex} />

<StorefrontFooter
	hotelSlug={data.hotel.slug}
	hotelName={data.hotel.name}
	city={data.hotel.city}
	showAmenities={data.hotelAmenities.length > 0}
	showFunctionHall={data.functionHalls.length > 0}
	showDining={true}
	showReviews={data.reviews.length > 0}
	facebookUrl={data.branding.facebookUrl}
	instagramUrl={data.branding.instagramUrl}
	tiktokUrl={data.branding.tiktokUrl}
/>
