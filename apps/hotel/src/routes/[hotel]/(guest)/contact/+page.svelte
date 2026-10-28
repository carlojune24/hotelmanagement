<script lang="ts">
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import MailIcon from '@lucide/svelte/icons/mail';
	import MapPinIcon from '@lucide/svelte/icons/map-pin';
	import StorefrontNav from '$lib/components/storefront/storefront-nav.svelte';
	import StorefrontFooter from '$lib/components/storefront/storefront-footer.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** A plain Google Maps embed — no API key needed either way. A precise pin dropped on the staff map
	    picker (`contactLat`/`contactLng`) wins when set (an exact coordinate, not a geocoded guess);
	    otherwise it falls back to an address-search embed. */
	const mapSrc = $derived(
		data.branding.contactLat != null && data.branding.contactLng != null
			? `https://www.google.com/maps?q=${data.branding.contactLat},${data.branding.contactLng}&output=embed`
			: data.branding.contactAddress
				? `https://www.google.com/maps?q=${encodeURIComponent(
						`${data.branding.contactAddress}, ${data.hotel.name}`
					)}&output=embed`
				: null
	);

	const hasAnyContactInfo = $derived(
		Boolean(data.branding.contactPhone || data.branding.contactEmail || data.branding.contactAddress)
	);
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
			<h1>Contact us</h1>
			<p class="sf-lede">Reach {data.hotel.name} directly — no middleman. Use the chat button for quick questions.</p>
		</div>
	</header>

	<section class="sf-section">
		<div class="sf-wrap sf-contact">
			<div>
				{#if hasAnyContactInfo}
					<div class="sf-contact-list">
						{#if data.branding.contactAddress}
							<div class="sf-contact-row">
								<MapPinIcon aria-hidden="true" />
								<div><small>Address</small>{data.branding.contactAddress}</div>
							</div>
						{/if}
						{#if data.branding.contactPhone}
							<div class="sf-contact-row">
								<PhoneIcon aria-hidden="true" />
								<div><small>Phone</small><a href="tel:{data.branding.contactPhone}">{data.branding.contactPhone}</a></div>
							</div>
						{/if}
						{#if data.branding.contactEmail}
							<div class="sf-contact-row">
								<MailIcon aria-hidden="true" />
								<div><small>Email</small><a href="mailto:{data.branding.contactEmail}">{data.branding.contactEmail}</a></div>
							</div>
						{/if}
					</div>
				{:else}
					<p class="sf-lede" style="margin-top: 0">Contact details are coming soon.</p>
				{/if}
				<div class="sf-feature-actions">
					<a href="/{data.hotel.slug}/dates" class="sf-btn">Check availability</a>
				</div>
			</div>

			{#if mapSrc}
				<div class="sf-contact-map">
					<iframe
						title="Map to {data.hotel.name}"
						src={mapSrc}
						loading="lazy"
						referrerpolicy="no-referrer-when-downgrade"
					></iframe>
				</div>
			{/if}
		</div>
	</section>
</main>

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
