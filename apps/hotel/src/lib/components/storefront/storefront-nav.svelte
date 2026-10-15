<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import MenuIcon from '@lucide/svelte/icons/menu';

	let {
		hotelSlug,
		hotelName,
		logoUrl,
		showAmenities,
		showFunctionHall,
		showDining,
		showReviews,
		transparentOverHero = false,
		accent,
		accentDeep,
		paper,
		paperDeep
	}: {
		hotelSlug: string;
		hotelName: string;
		logoUrl: string | null | undefined;
		showAmenities: boolean;
		showFunctionHall: boolean;
		showDining: boolean;
		showReviews: boolean;
		/** True only on the homepage, and only when it has a hero photo for the nav to sit
		    over — every other page (Dining, Contact, Meetings & Events, Room Detail) leaves
		    this unset and gets the plain solid-from-the-start nav, unchanged. */
		transparentOverHero?: boolean;
		/** Per-hotel theme values (from the page's own `data.theme`), needed again here
		    because the mobile nav's `Sheet` content renders through a bits-ui portal to
		    `document.body` by default — outside the `.woven-ledger` wrapper div in
		    `+layout.svelte` that normally carries these as inline custom properties.
		    Inline style doesn't reach across a portal boundary the way DOM-tree CSS
		    inheritance does, so the sheet re-declares them on itself. */
		accent: string;
		accentDeep: string;
		paper: string;
		paperDeep: string;
	} = $props();

	const mobileNavThemeStyle = $derived(
		`--hotel-accent: ${accent}; --hotel-accent-deep: ${accentDeep}; ` +
			`--ledger-paper: ${paper}; --ledger-paper-2: ${paperDeep};`
	);

	// Solid once the guest has scrolled past the hero's top edge — a small fixed threshold
	// tuned by eye, not measured against the hero's real height (which varies by content).
	const SCROLL_THRESHOLD = 48;
	let scrolled = $state(false);
	onMount(() => {
		if (!transparentOverHero) return;
		const onScroll = () => {
			scrolled = window.scrollY > SCROLL_THRESHOLD;
		};
		onScroll();
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => window.removeEventListener('scroll', onScroll);
	});

	// Absolute /{hotelSlug}/... paths throughout — deliberate, not the relative-path convention
	// used elsewhere in this route tree, since this same nav renders from several different
	// nesting depths (homepage, dining, meetings-events, contact, and eventually room detail
	// pages) and absolute paths can't accidentally resolve one directory short/long the way a
	// hand-computed `../` chain repeatedly did this session.
	const base = `/${hotelSlug}`;

	let mobileNavOpen = $state(false);
</script>

<nav class="storefront-nav" class:is-transparent={transparentOverHero && !scrolled}>
	<div class="storefront-nav-inner">
		<a href="{base}#top" class="storefront-nav-brand flex items-center gap-3.5">
			{#if logoUrl}
				<img src={logoUrl} alt="" class="h-14 w-auto object-contain" />
			{/if}
			<span class="storefront-nav-brand-name ledger-display text-xl">{hotelName}</span>
		</a>
		<div class="storefront-nav-links">
			<a href="{base}#about" class="storefront-nav-link">About</a>
			{#if showAmenities}
				<a href="{base}#amenities" class="storefront-nav-link">Amenities</a>
			{/if}
			<a href="{base}#rooms" class="storefront-nav-link">Rooms &amp; Rates</a>
			{#if showFunctionHall}
				<a href="{base}/meetings-events" class="storefront-nav-link">Meetings &amp; Events</a>
			{/if}
			{#if showDining}
				<a href="{base}/dining" class="storefront-nav-link">Dining</a>
			{/if}
			<a href="{base}#gallery" class="storefront-nav-link">Gallery</a>
			{#if showReviews}
				<a href="{base}#reviews" class="storefront-nav-link">Reviews</a>
			{/if}
			<a href="{base}/contact" class="storefront-nav-link">Contact</a>
		</div>
		<div class="flex items-center gap-2">
			<Button
				href="{base}#search"
				class="ledger-btn-primary storefront-nav-book-full !px-5 !py-2 text-sm">Book Now</Button
			>
			<Button href="{base}#search" class="ledger-btn-primary storefront-nav-book-compact !px-4 !py-2 text-sm"
				>Book</Button
			>
			<button
				type="button"
				class="storefront-nav-menu-btn"
				aria-label="Open menu"
				aria-expanded={mobileNavOpen}
				onclick={() => (mobileNavOpen = true)}
			>
				<MenuIcon class="size-5" />
			</button>
		</div>
	</div>
</nav>

<Sheet.Root bind:open={mobileNavOpen}>
	<Sheet.Content
		side="right"
		style={mobileNavThemeStyle}
		class="woven-ledger w-full border-l-[var(--ledger-rule)] bg-[var(--ledger-paper)] text-[var(--ledger-ink)] sm:max-w-xs"
	>
		<Sheet.Header>
			<Sheet.Title class="ledger-display text-lg">{hotelName}</Sheet.Title>
		</Sheet.Header>
		<nav class="flex flex-col gap-1 px-4 pb-6" aria-label="Site">
			<a
				href="{base}#about"
				class="storefront-nav-mobile-link"
				onclick={() => (mobileNavOpen = false)}>About</a
			>
			{#if showAmenities}
				<a
					href="{base}#amenities"
					class="storefront-nav-mobile-link"
					onclick={() => (mobileNavOpen = false)}>Amenities</a
				>
			{/if}
			<a href="{base}#rooms" class="storefront-nav-mobile-link" onclick={() => (mobileNavOpen = false)}
				>Rooms &amp; Rates</a
			>
			{#if showFunctionHall}
				<a
					href="{base}/meetings-events"
					class="storefront-nav-mobile-link"
					onclick={() => (mobileNavOpen = false)}>Meetings &amp; Events</a
				>
			{/if}
			{#if showDining}
				<a
					href="{base}/dining"
					class="storefront-nav-mobile-link"
					onclick={() => (mobileNavOpen = false)}>Dining</a
				>
			{/if}
			<a
				href="{base}#gallery"
				class="storefront-nav-mobile-link"
				onclick={() => (mobileNavOpen = false)}>Gallery</a
			>
			{#if showReviews}
				<a
					href="{base}#reviews"
					class="storefront-nav-mobile-link"
					onclick={() => (mobileNavOpen = false)}>Reviews</a
				>
			{/if}
			<a
				href="{base}/contact"
				class="storefront-nav-mobile-link"
				onclick={() => (mobileNavOpen = false)}>Contact</a
			>
			<Button
				href="{base}#search"
				class="ledger-btn-primary mt-4 w-full"
				onclick={() => (mobileNavOpen = false)}
			>
				Book Now
			</Button>
		</nav>
	</Sheet.Content>
</Sheet.Root>
