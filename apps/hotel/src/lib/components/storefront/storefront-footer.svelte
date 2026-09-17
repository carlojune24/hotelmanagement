<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import MusicIcon from '@lucide/svelte/icons/music';

	let {
		hotelSlug,
		hotelName,
		city,
		showAmenities,
		showFunctionHall,
		showDining,
		showReviews,
		facebookUrl,
		instagramUrl,
		tiktokUrl
	}: {
		hotelSlug: string;
		hotelName: string;
		city: string | null | undefined;
		showAmenities: boolean;
		showFunctionHall: boolean;
		showDining: boolean;
		showReviews: boolean;
		facebookUrl: string | null | undefined;
		instagramUrl: string | null | undefined;
		tiktokUrl: string | null | undefined;
	} = $props();

	// Same absolute-path convention as storefront-nav.svelte — this footer renders from
	// several different nesting depths (homepage, dining, meetings-events, contact).
	const base = `/${hotelSlug}`;
	const year = new Date().getFullYear();
	const hasSocial = $derived(Boolean(facebookUrl || instagramUrl || tiktokUrl));
</script>

<footer class="storefront-footer">
	<div class="storefront-footer-grid">
		<div class="storefront-footer-brand">
			<div class="ledger-display text-lg">{hotelName}</div>
			{#if city}
				<p class="mt-1 text-sm text-[var(--ledger-ink-muted)]">{city}, Philippines</p>
			{/if}
			<p class="mt-3 max-w-xs text-sm text-[var(--ledger-ink-muted)]">
				Booked directly with the hotel — the price you see on review is the price you pay, no
				third-party markup.
			</p>
		</div>

		<div class="storefront-footer-col">
			<div class="ledger-label">Explore</div>
			<nav class="storefront-footer-links">
				<a href="{base}#about">About</a>
				{#if showAmenities}
					<a href="{base}#amenities">Amenities</a>
				{/if}
				<a href="{base}#rooms">Rooms &amp; Rates</a>
				{#if showFunctionHall}
					<a href="{base}/meetings-events">Meetings &amp; Events</a>
				{/if}
				{#if showDining}
					<a href="{base}/dining">Dining</a>
				{/if}
				<a href="{base}#gallery">Gallery</a>
				{#if showReviews}
					<a href="{base}#reviews">Reviews</a>
				{/if}
				<a href="{base}/contact">Contact</a>
			</nav>
		</div>

		{#if hasSocial}
			<div class="storefront-footer-col">
				<div class="ledger-label">Follow</div>
				<div class="storefront-footer-social">
					{#if facebookUrl}
						<a href={facebookUrl} target="_blank" rel="noopener noreferrer" aria-label="Facebook">
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
							</svg>
						</a>
					{/if}
					{#if instagramUrl}
						<a href={instagramUrl} target="_blank" rel="noopener noreferrer" aria-label="Instagram">
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
								<path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
								<line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
							</svg>
						</a>
					{/if}
					{#if tiktokUrl}
						<a href={tiktokUrl} target="_blank" rel="noopener noreferrer" aria-label="TikTok">
							<MusicIcon aria-hidden="true" />
						</a>
					{/if}
				</div>
			</div>
		{/if}
	</div>

	<div class="storefront-footer-bottom">
		<p class="text-xs text-[var(--ledger-ink-muted)]">© {year} {hotelName}</p>
		<Button href="{base}#search" class="ledger-btn-primary">Check availability</Button>
	</div>
</footer>
