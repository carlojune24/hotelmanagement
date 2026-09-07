<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
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
	import type { BedConfigEntry } from '$lib/server/db/schema/inventory';
	import type { AmenityDetail } from '$lib/server/availability';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const peso = (centavos: number) =>
		`₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

	const rt = $derived(data.roomType);

	const bedConfigText = (entries: BedConfigEntry[]) =>
		entries.map((e) => `${e.quantity} ${e.type}`).join(' + ');

	const mainPhoto = $derived(rt.photos.find((p) => p.tag === 'cover') ?? rt.photos[0] ?? null);
	const restPhotos = $derived(mainPhoto ? rt.photos.filter((p) => p.url !== mainPhoto.url) : []);

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

	/** Book Now hands off into the wizard as a plain link, not shared state — dated mode already
	    has verified dates/occupancy, so it skips straight to room selection; undated mode starts
	    the wizard at the Dates step, carrying this room type through as a UI hint only. */
	const bookNowHref = $derived(
		data.mode === 'dated'
			? `../rooms?checkIn=${data.checkIn}&checkOut=${data.checkOut}&adults=${data.adults}&children=${data.children}&roomTypeId=${rt.id}`
			: `../dates?roomTypeId=${rt.id}`
	);

	let lightboxSrc = $state<string | null>(null);
	function hidePhoto(e: Event) {
		(e.currentTarget as HTMLImageElement).style.display = 'none';
	}
</script>

<svelte:head>
	<title>{rt.name} — {data.hotel.name}</title>
</svelte:head>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') lightboxSrc = null;
	}}
/>

<div class="storefront-room-page mx-auto max-w-4xl px-4 py-8 sm:px-6">
	<p class="ledger-label">{data.hotel.name}</p>
	<h1 class="ledger-display mt-1 text-3xl sm:text-4xl">{rt.name}</h1>

	{#if data.mode === 'dated'}
		<p class="storefront-room-dialog-price">
			<span class="ledger-data text-lg">{peso(data.fromTotalCentavos)}</span>
			<span class="ledger-label">total · {data.checkIn} → {data.checkOut}</span>
		</p>
	{:else if data.roomType.startingPriceCentavos != null}
		<p class="storefront-room-dialog-price">
			<span class="ledger-data text-lg">{peso(data.roomType.startingPriceCentavos)}</span>
			<span class="ledger-label">/ night, from</span>
		</p>
	{/if}

	<Button href={bookNowHref} class="ledger-btn-primary mt-4">Book now</Button>

	{#if mainPhoto}
		<div class="storefront-room-dialog-gallery mt-8">
			<button
				type="button"
				class="storefront-room-dialog-photo-main"
				onclick={() => (lightboxSrc = mainPhoto!.url)}
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

	{#if rt.description}
		<p class="storefront-room-dialog-desc mt-6">{rt.description}</p>
	{/if}

	<div class="storefront-glance-row mt-6">
		<span class="storefront-room-dialog-spec-chip">
			<UsersIcon aria-hidden="true" />
			<span>Sleeps {rt.baseOccupancy}–{rt.maxOccupancy}</span>
		</span>
		{#if rt.sizeSqm}
			<span class="storefront-room-dialog-spec-chip">
				<RulerIcon aria-hidden="true" />
				<span>{rt.sizeSqm} m²</span>
			</span>
		{/if}
		{#if rt.bedConfiguration.length > 0}
			<span class="storefront-room-dialog-spec-chip">
				<BedIcon aria-hidden="true" />
				<span
					>{bedConfigText(rt.bedConfiguration)}{rt.bedFlexible ? ' (flexible)' : ''}</span
				>
			</span>
		{/if}
		{#if rt.viewType}
			<span class="storefront-room-dialog-spec-chip">
				<EyeIcon aria-hidden="true" />
				<span>{rt.viewType}</span>
			</span>
		{/if}
		<span class="storefront-room-dialog-spec-chip">
			{#if rt.smokingPolicy === 'non_smoking'}
				<CigaretteOffIcon aria-hidden="true" />
				<span>Non-smoking</span>
			{:else}
				<FlameIcon aria-hidden="true" />
				<span>Smoking allowed</span>
			{/if}
		</span>
		{#if rt.wheelchairAccessible}
			<span class="storefront-room-dialog-spec-chip">
				<AccessibilityIcon aria-hidden="true" />
				<span>Wheelchair accessible</span>
			</span>
		{/if}
		{#if rt.rollInShower}
			<span class="storefront-room-dialog-spec-chip">
				<ShowerHeadIcon aria-hidden="true" />
				<span>Roll-in shower</span>
			</span>
		{/if}
		{#if rt.grabBars}
			<span class="storefront-room-dialog-spec-chip">
				<ShieldCheckIcon aria-hidden="true" />
				<span>Grab bars</span>
			</span>
		{/if}
	</div>
	{#if rt.bedFlexible && rt.flexibilityNote}
		<p class="storefront-room-dialog-note mt-2">{rt.flexibilityNote}</p>
	{/if}

	{#if data.branding.checkInPolicy || data.branding.checkOutPolicy}
		<div class="storefront-room-page-policies mt-8">
			{#if data.branding.checkInPolicy}
				<h2 class="ledger-display text-xl">Check-in</h2>
				<p class="mt-1 text-sm text-[var(--ledger-ink-muted)]">{data.branding.checkInPolicy}</p>
			{/if}
			{#if data.branding.checkOutPolicy}
				<h2 class="ledger-display mt-4 text-xl">Check-out</h2>
				<p class="mt-1 text-sm text-[var(--ledger-ink-muted)]">{data.branding.checkOutPolicy}</p>
			{/if}
		</div>
	{/if}

	{#if groupedAmenities.length > 0}
		<div class="storefront-room-dialog-amenities mt-8">
			<h2 class="ledger-display text-xl">Amenities</h2>
			{#each groupedAmenities as group (group.category)}
				<h3 class="storefront-amenity-group-head">{group.label}</h3>
				<ul class="storefront-amenity-list">
					{#each group.items as a (a.name)}
						{@const Icon = amenityIcon(a.icon)}
						<li class="storefront-amenity-item">
							<Icon aria-hidden="true" />
							<span>{a.name}</span>
						</li>
					{/each}
				</ul>
			{/each}
		</div>
	{/if}

	<Button href={bookNowHref} class="ledger-btn-primary mt-10">Book now</Button>
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
