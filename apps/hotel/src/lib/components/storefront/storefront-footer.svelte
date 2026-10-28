<script lang="ts">
	import { guestBase } from '$lib/guest-base';
	import { page } from '$app/state';
	import MusicIcon from '@lucide/svelte/icons/music';
	const base = $derived(guestBase(page));

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
		tiktokUrl,
		phone,
		email,
		address
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
		phone?: string | null;
		email?: string | null;
		address?: string | null;
	} = $props();

	// Same absolute-path convention as storefront-nav.svelte.
	const year = new Date().getFullYear();
	const hasSocial = $derived(Boolean(facebookUrl || instagramUrl || tiktokUrl));
	const hasContact = $derived(Boolean(phone || email || address));
</script>

<footer class="sf-foot">
	<div class="sf-wrap">
		<div class="sf-foot-cta">
			<h2>Your stay at {hotelName} starts here.</h2>
			<a href="{base}/dates" class="sf-btn sf-btn--light">Check availability</a>
		</div>

		<div class="sf-foot-grid">
			<div>
				<div class="sf-foot-brand">{hotelName}</div>
				{#if city}<p class="sf-foot-note" style="margin-top: 0.25rem">{city}, Philippines</p>{/if}
				<p class="sf-foot-note">
					Booked directly with the hotel — the price you see on review is the price you pay, no
					third-party markup.
				</p>
			</div>

			<div>
				<h3>Explore</h3>
				<nav aria-label="Footer">
					<a href="{base || '/'}#about">About</a>
					<a href="{base || '/'}#rooms">Rooms &amp; Rates</a>
					{#if showAmenities}<a href="{base || '/'}#amenities">Amenities</a>{/if}
					{#if showDining}<a href="{base}/dining">Dining</a>{/if}
					{#if showFunctionHall}<a href="{base}/meetings-events">Meetings &amp; Events</a>{/if}
					<a href="{base || '/'}#gallery">Gallery</a>
					{#if showReviews}<a href="{base || '/'}#reviews">Reviews</a>{/if}
				</nav>
			</div>

			<div>
				<h3>Contact</h3>
				<div class="sf-foot-contact">
					{#if address}<span>{address}</span>{/if}
					{#if phone}<a href="tel:{phone}">{phone}</a>{/if}
					{#if email}<a href="mailto:{email}">{email}</a>{/if}
					{#if !hasContact}<a href="{base}/contact">Contact us</a>{:else}<a href="{base}/contact">Map &amp; directions</a>{/if}
				</div>
			</div>

			{#if hasSocial}
				<div>
					<h3>Follow</h3>
					<div class="sf-foot-social">
						{#if facebookUrl}
							<a href={facebookUrl} target="_blank" rel="noopener noreferrer" aria-label="Facebook">
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
								</svg>
							</a>
						{/if}
						{#if instagramUrl}
							<a href={instagramUrl} target="_blank" rel="noopener noreferrer" aria-label="Instagram">
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
									<path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
									<line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
								</svg>
							</a>
						{/if}
						{#if tiktokUrl}
							<a href={tiktokUrl} target="_blank" rel="noopener noreferrer" aria-label="TikTok">
								<MusicIcon class="size-[18px]" aria-hidden="true" />
							</a>
						{/if}
					</div>
				</div>
			{/if}
		</div>

		<p class="sf-foot-bottom">© {year} {hotelName}</p>
	</div>
</footer>
