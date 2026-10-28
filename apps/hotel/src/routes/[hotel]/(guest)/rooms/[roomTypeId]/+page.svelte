<script lang="ts">
	import { page } from '$app/state';
	import { guestBase } from '$lib/guest-base';
	import { brandTitle } from '$lib/seo';

	import { amenityIcon } from '$lib/amenity-icons';
	import { AMENITY_CATEGORY_LABELS, AMENITY_CATEGORY_ORDER } from '$lib/amenity-categories';
	import BedIcon from '@lucide/svelte/icons/bed';
	import RulerIcon from '@lucide/svelte/icons/ruler';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import UsersIcon from '@lucide/svelte/icons/users';
	import CigaretteOffIcon from '@lucide/svelte/icons/cigarette-off';
	import FlameIcon from '@lucide/svelte/icons/flame';
	import AccessibilityIcon from '@lucide/svelte/icons/accessibility';
	import ShowerHeadIcon from '@lucide/svelte/icons/shower-head';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import { humanize } from '$lib/room-line';
	import type { BedConfigEntry } from '$lib/server/db/schema/inventory';
	import type { AmenityDetail } from '$lib/server/availability';
	import StorefrontNav from '$lib/components/storefront/storefront-nav.svelte';
	import StorefrontFooter from '$lib/components/storefront/storefront-footer.svelte';
	import StorefrontLightbox from '$lib/components/storefront/storefront-lightbox.svelte';
	import type { PageData } from './$types';
	const base = $derived(guestBase(page));

	let { data }: { data: PageData } = $props();

	const peso = (centavos: number) =>
		`₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

	const rt = $derived(data.roomType);
	const slug = $derived(data.hotel.slug);

	const bedConfigText = (entries: BedConfigEntry[]) =>
		entries.map((e) => `${e.quantity} ${e.type}`).join(' + ');

	const mainPhoto = $derived(rt.photos.find((p) => p.tag === 'cover') ?? rt.photos[0] ?? null);
	const restPhotos = $derived(mainPhoto ? rt.photos.filter((p) => p.url !== mainPhoto.url) : []);
	// Main photo first, then the strip — the same order the page shows them in, so a thumbnail's position
	// in the lightbox matches the one the guest just clicked.
	const allPhotoUrls = $derived(mainPhoto ? [mainPhoto, ...restPhotos].map((p) => p.url) : []);

	const groupedAmenities = $derived.by(() => {
		const byCategory = new Map<string, AmenityDetail[]>();
		for (const a of rt.amenities) {
			const list = byCategory.get(a.category) ?? [];
			list.push(a);
			byCategory.set(a.category, list);
		}
		return AMENITY_CATEGORY_ORDER.filter((cat) => byCategory.has(cat)).map((cat) => ({
			category: cat,
			label: AMENITY_CATEGORY_LABELS[cat],
			items: byCategory.get(cat)!
		}));
	});

	/** Book now hands off into the wizard as a plain link, not shared state: dated mode already has
	    verified dates/occupancy, so it skips to room selection; undated mode starts at the Dates step. */
	const bookNowHref = $derived(
		data.mode === 'dated'
			? `${base}/rooms?checkIn=${data.checkIn}&checkOut=${data.checkOut}&adults=${data.adults}&children=${data.children}&roomTypeId=${rt.id}`
			: `${base}/dates?roomTypeId=${rt.id}`
	);

	let lightboxIndex = $state<number | null>(null);
	function hidePhoto(e: Event) {
		(e.currentTarget as HTMLImageElement).style.display = 'none';
	}
</script>

<svelte:head>
	<title>{rt.name} — {brandTitle(data.hotel.name, data.hotel.city)}</title>
</svelte:head>

<StorefrontNav
	hotelSlug={slug}
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
	<header class="sf-page-head" style="padding-bottom: clamp(1.5rem, 4vw, 2.5rem)">
		<div class="sf-wrap">
			<a href="{base || '/'}#rooms" class="sf-link" style="font-size: 0.875rem"><ArrowLeftIcon class="size-4" aria-hidden="true" /> All rooms</a>
			<h1 style="margin-top: 1rem">{rt.name}</h1>
		</div>
	</header>

	<section class="sf-section" style="padding-top: clamp(1.5rem, 4vw, 2.5rem)">
		<div class="sf-wrap">
			{#if mainPhoto}
				<div class="sf-venue-gallery" style="margin-bottom: clamp(2rem, 5vw, 3.5rem)">
					<button type="button" class="sf-venue-main" style="aspect-ratio: 16 / 9" onclick={() => (lightboxIndex = 0)} aria-label="View photos of {rt.name} larger">
						<img src={mainPhoto.url} alt="" onerror={hidePhoto} />
					</button>
					{#if restPhotos.length > 0}
						<div class="sf-venue-thumbs" style="grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr))">
							{#each restPhotos as photo, i (photo.url)}
								<button type="button" onclick={() => (lightboxIndex = i + 1)} aria-label="View photo {i + 2} larger">
									<img src={photo.url} alt="" loading="lazy" onerror={hidePhoto} />
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			<div class="sf-room-page-grid">
				<div>
					{#if rt.description}<p class="sf-about-text" style="font-size: clamp(1.25rem, 2.2vw, 1.625rem)">{rt.description}</p>{/if}

					<div class="sf-chips" style="margin-top: 1.5rem">
						<span class="sf-chip-static"><UsersIcon aria-hidden="true" />Sleeps {rt.baseOccupancy}–{rt.maxOccupancy}</span>
						{#if rt.sizeSqm}<span class="sf-chip-static"><RulerIcon aria-hidden="true" />{rt.sizeSqm} m²</span>{/if}
						{#if rt.bedConfiguration.length > 0}
							<span class="sf-chip-static"><BedIcon aria-hidden="true" />{bedConfigText(rt.bedConfiguration)}{rt.bedFlexible ? ' (flexible)' : ''}</span>
						{/if}
						{#if rt.viewType}<span class="sf-chip-static"><EyeIcon aria-hidden="true" />{humanize(rt.viewType)}</span>{/if}
						<span class="sf-chip-static">
							{#if rt.smokingPolicy === 'non_smoking'}<CigaretteOffIcon aria-hidden="true" />Non-smoking{:else}<FlameIcon aria-hidden="true" />Smoking allowed{/if}
						</span>
						{#if rt.wheelchairAccessible}<span class="sf-chip-static"><AccessibilityIcon aria-hidden="true" />Wheelchair accessible</span>{/if}
						{#if rt.rollInShower}<span class="sf-chip-static"><ShowerHeadIcon aria-hidden="true" />Roll-in shower</span>{/if}
						{#if rt.grabBars}<span class="sf-chip-static"><ShieldCheckIcon aria-hidden="true" />Grab bars</span>{/if}
					</div>
					{#if rt.bedFlexible && rt.flexibilityNote}
						<p class="mt-3 text-sm text-[var(--ledger-ink-muted)]">{rt.flexibilityNote}</p>
					{/if}

					{#if groupedAmenities.length > 0}
						<h2 class="sf-prose-h">What's included</h2>
						{#each groupedAmenities as group (group.category)}
							<p class="mt-5 text-xs font-semibold tracking-wide text-[var(--ledger-ink-muted)] uppercase">{group.label}</p>
							<ul class="sf-plain-list" style="margin-top: 0.5rem">
								{#each group.items as a (a.name)}
									{@const Icon = amenityIcon(a.icon)}
									<li class="flex items-center gap-2"><Icon class="size-4 shrink-0 text-[var(--hotel-accent)]" aria-hidden="true" />{a.name}</li>
								{/each}
							</ul>
						{/each}
					{/if}

					{#if data.branding.checkInPolicy || data.branding.checkOutPolicy}
						<h2 class="sf-prose-h">Check-in &amp; check-out</h2>
						{#if data.branding.checkInPolicy}<p class="text-[var(--ledger-ink-muted)]"><b class="text-[var(--ledger-ink)]">Check-in.</b> {data.branding.checkInPolicy}</p>{/if}
						{#if data.branding.checkOutPolicy}<p class="mt-2 text-[var(--ledger-ink-muted)]"><b class="text-[var(--ledger-ink)]">Check-out.</b> {data.branding.checkOutPolicy}</p>{/if}
					{/if}
				</div>

				<aside class="sf-aside" aria-label="Book {rt.name}">
					{#if data.mode === 'dated'}
						<div class="sf-aside-price">
							<span class="text-sm text-[var(--ledger-ink-muted)]">Your stay, from</span>
							<b>{peso(data.fromTotalCentavos)}</b>
							<span class="text-sm text-[var(--ledger-ink-muted)]">total · {data.checkIn} → {data.checkOut}</span>
						</div>
					{:else if data.roomType.startingPriceCentavos != null}
						<div class="sf-aside-price">
							<span class="text-sm text-[var(--ledger-ink-muted)]">From</span>
							<b>{peso(data.roomType.startingPriceCentavos)}</b>
							<span class="text-sm text-[var(--ledger-ink-muted)]">per night</span>
						</div>
					{/if}
					<a href={bookNowHref} class="sf-btn" style="width: 100%; margin-top: 1.25rem">
						{data.mode === 'dated' ? 'Choose a rate' : 'Check dates & book'}
					</a>
					<p class="mt-3 text-center text-xs text-[var(--ledger-ink-muted)]">Book directly with the hotel — no third-party markup.</p>
				</aside>
			</div>
		</div>
	</section>
</main>

<StorefrontLightbox images={allPhotoUrls} bind:index={lightboxIndex} />

<StorefrontFooter
	hotelSlug={slug}
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
