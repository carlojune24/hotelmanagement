<script lang="ts">
	import StorefrontNav from '$lib/components/storefront/storefront-nav.svelte';
	import StorefrontFooter from '$lib/components/storefront/storefront-footer.svelte';
	import StorefrontLightbox from '$lib/components/storefront/storefront-lightbox.svelte';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import UtensilsCrossedIcon from '@lucide/svelte/icons/utensils-crossed';
	import SlidersHorizontalIcon from '@lucide/svelte/icons/sliders-horizontal';
	import type { DiningPhoto } from '$lib/server/db/schema/dining';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const menuImages = $derived(data.dining.menuImages ?? []);

	const peso = (centavos: number) =>
		`₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

	/** A venue's menu grouped by category, uncategorised dishes last. */
	function menuSections(venueId: string) {
		const menu = data.diningMenus[venueId];
		if (!menu) return [];
		const sections = menu.categories.map((c) => ({
			id: c.id,
			name: c.name,
			items: menu.items.filter((i) => i.categoryId === c.id)
		}));
		const loose = menu.items.filter((i) => !menu.categories.some((c) => c.id === i.categoryId));
		if (loose.length) sections.push({ id: 'other', name: sections.length ? 'Also' : '', items: loose });
		return sections.filter((s) => s.items.length > 0);
	}

	/** Every dish photo on a venue's menu, in menu order, for the lightbox. */
	const dishPhotos = (venueId: string) =>
		(data.diningMenus[venueId]?.items ?? []).flatMap((i) => (i.imageUrl ? [i.imageUrl] : []));

	const venuePhotos = (photos: unknown) => (photos as DiningPhoto[] | null) ?? [];

	// One shared lightbox for the page: a venue's gallery, a dish photo and the menu images each load their
	// own set on click.
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

<main>
	<header class="sf-page-head">
		<div class="sf-wrap">
			<h1>{data.dining.introHeading ?? `Dining at ${data.hotel.name}`}</h1>
			{#if data.dining.introEyebrow}<p class="sf-venue-cat">{data.dining.introEyebrow}</p>{/if}
			<p class="sf-lede">
				{data.dining.introBody ?? 'Restaurants, bars and cafés on the property.'}
			</p>
			{#if menuImages.length > 0}
				<div class="sf-page-head-actions"><a href="#menus" class="sf-btn">View menu</a></div>
			{/if}
		</div>
	</header>

	{#if data.diningItems.length > 1}
		<nav class="sf-venue-nav" aria-label="Venues">
			<div class="sf-wrap">
				<ul>
					{#each data.diningItems as item (item.id)}
						<li><a class="sf-chip" href="#venue-{item.id}">{item.title}</a></li>
					{/each}
					{#if menuImages.length > 0}<li><a class="sf-chip" href="#menus">Menus</a></li>{/if}
				</ul>
			</div>
		</nav>
	{/if}

	{#if data.diningItems.length === 0}
		<section class="sf-section"><div class="sf-wrap"><p class="sf-lede">Dining information is coming soon.</p></div></section>
	{:else}
		{#each data.diningItems as item, vi (item.id)}
			{@const photos = venuePhotos(item.photos)}
			{@const highlights = item.highlights as string[]}
			{@const mainPhoto = photos.find((p) => p.tag === 'cover') ?? photos[0] ?? null}
			{@const restPhotos = mainPhoto ? photos.filter((p) => p.url !== mainPhoto.url) : []}
			{@const allUrls = mainPhoto ? [mainPhoto, ...restPhotos].map((p) => p.url) : []}
			{@const sections = menuSections(item.id)}
			<section id="venue-{item.id}" class="sf-venue">
				<div class="sf-wrap">
					<div class="sf-venue-grid" class:is-flip={vi % 2 === 1}>
						<div class="sf-venue-gallery">
							{#if mainPhoto}
								<button type="button" class="sf-venue-main" onclick={() => openLightbox(allUrls, 0)} aria-label="View {item.title} photos larger">
									<img src={mainPhoto.url} alt="" onerror={hidePhoto} />
								</button>
								{#if restPhotos.length > 0}
									<div class="sf-venue-thumbs">
										{#each restPhotos.slice(0, 4) as photo, j (photo.url)}
											<button type="button" onclick={() => openLightbox(allUrls, j + 1)} aria-label="View photo {j + 2} larger">
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
							<h2>{item.title}</h2>
							{#if item.category}<p class="sf-venue-cat">{item.category}</p>{/if}
							{#if item.tagline}<p class="sf-venue-tag">{item.tagline}</p>{/if}
							{#if item.description}<p class="sf-venue-desc">{item.description}</p>{/if}

							{#if highlights.length > 0}
								<ul class="sf-venue-points">
									{#each highlights as h (h)}
										<li><CircleCheckIcon aria-hidden="true" /><span>{h}</span></li>
									{/each}
								</ul>
							{/if}

							{#if item.operatingHours}
								<p class="sf-venue-hours"><ClockIcon aria-hidden="true" />{item.operatingHours}</p>
							{/if}

							{#if item.reservationsEnabled || data.orderableVenueIds.includes(item.id)}
								<div class="sf-feature-actions">
									{#if item.reservationsEnabled}
										<a href="/{data.hotel.slug}/dining/reserve?venue={item.id}" class="sf-btn">Reserve a table</a>
									{/if}
									{#if data.orderableVenueIds.includes(item.id)}
										<a href="/{data.hotel.slug}/dining/order?venue={item.id}" class="sf-btn sf-btn--outline">Order online</a>
									{/if}
								</div>
							{/if}
						</div>
					</div>

					{#if sections.length > 0}
						{@const dishCount = sections.reduce((n, sec) => n + sec.items.length, 0)}
						{@const canReserve = item.reservationsEnabled}
						{@const canOrder = data.orderableVenueIds.includes(item.id)}
						<div class="sf-menu" aria-label="{item.title} menu">
							<div class="sf-menu-head">
								<div>
									<h3>The {item.title} menu</h3>
									<p class="sf-menu-sub">
										{dishCount} dish{dishCount === 1 ? '' : 'es'}{sections.length > 1 ? ` across ${sections.length} categories` : ''}. Tap a photo to see it larger.
									</p>
								</div>
								{#if canOrder || canReserve}
									<div class="sf-feature-actions">
										{#if canOrder}<a href="/{data.hotel.slug}/dining/order?venue={item.id}" class="sf-btn">Order online</a>{/if}
										{#if canReserve}<a href="/{data.hotel.slug}/dining/reserve?venue={item.id}" class="sf-btn sf-btn--outline">Reserve a table</a>{/if}
									</div>
								{/if}
							</div>

							{#if sections.length > 1}
								<ul class="sf-menu-tabs" aria-label="Menu categories">
									{#each sections as section (section.id)}
										<li><a class="sf-chip" href="#menu-{item.id}-{section.id}">{section.name || 'Menu'}</a></li>
									{/each}
								</ul>
							{/if}

							{#each sections as section (section.id)}
								<div class="sf-menu-block" id="menu-{item.id}-{section.id}">
									{#if section.name}
										<h4 class="sf-menu-cat">{section.name} <span>{section.items.length}</span></h4>
									{/if}
									<ul class="sf-dishes">
										{#each section.items as dish (dish.id)}
											{@const dp = dishPhotos(item.id)}
											<li class="sf-dish" class:is-sold-out={!dish.isAvailable}>
												{#if dish.imageUrl}
													<button type="button" class="sf-dish-photo" onclick={() => openLightbox(dp, dp.indexOf(dish.imageUrl!))} aria-label="View photo of {dish.name} larger">
														<img src={dish.imageUrl} alt="" loading="lazy" onerror={hidePhoto} />
													</button>
												{:else}
													<div class="sf-dish-photo is-empty" aria-hidden="true"><UtensilsCrossedIcon /></div>
												{/if}
												{#if !dish.isAvailable}<span class="sf-dish-flag">Sold out today</span>{/if}
												<div class="sf-dish-body">
													<div class="sf-dish-top">
														<h5 class="sf-dish-name">{dish.name}</h5>
														<span class="sf-dish-price">{peso(dish.priceCentavos)}</span>
													</div>
													{#if dish.description}<p class="sf-dish-desc">{dish.description}</p>{/if}
													{#if dish.hasAddons && dish.isAvailable}
														<p class="sf-dish-note"><SlidersHorizontalIcon aria-hidden="true" />Make it yours: add-ons and options available</p>
													{/if}
												</div>
											</li>
										{/each}
									</ul>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</section>
		{/each}
	{/if}

	{#if menuImages.length > 0}
		<section id="menus" class="sf-section sf-section--tint">
			<div class="sf-wrap">
				<div class="sf-head"><h2 class="sf-h2">Menus</h2></div>
				<div class="sf-gallery">
					{#each menuImages as url, i (url)}
						<button type="button" onclick={() => openLightbox(menuImages, i)} aria-label="View menu page {i + 1} larger">
							<img src={url} alt="" loading="lazy" onerror={hidePhoto} />
						</button>
					{/each}
				</div>
			</div>
		</section>
	{/if}
</main>

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
	phone={data.branding.contactPhone}
	email={data.branding.contactEmail}
	address={data.branding.contactAddress}
/>
