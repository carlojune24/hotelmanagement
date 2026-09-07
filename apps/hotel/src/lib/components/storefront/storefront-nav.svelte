<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	let {
		hotelSlug,
		hotelName,
		logoUrl,
		showAmenities,
		showFunctionHall,
		showDining,
		showReviews,
		transparentOverHero = false
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
	} = $props();

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
	const base = `/${hotelSlug}/book`;
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
		<Button href="{base}#search" class="ledger-btn-primary !px-5 !py-2 text-sm">Reserve</Button>
	</div>
</nav>
