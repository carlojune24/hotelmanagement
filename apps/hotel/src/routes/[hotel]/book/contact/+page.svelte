<script lang="ts">
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import MailIcon from '@lucide/svelte/icons/mail';
	import MapPinIcon from '@lucide/svelte/icons/map-pin';
	import StorefrontNav from '$lib/components/storefront/storefront-nav.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** A plain Google Maps embed — no API key needed either way. A precise pin dropped on
	    the staff map picker (`contactLat`/`contactLng`) wins when set (an exact coordinate,
	    not a geocoded guess); otherwise falls back to an address-search embed. */
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

<svelte:head>
	<title>Contact Us — {data.hotel.name}</title>
</svelte:head>

<StorefrontNav
	hotelSlug={data.hotel.slug}
	hotelName={data.hotel.name}
	logoUrl={data.branding.logoUrl}
	showAmenities={data.hotelAmenities.length > 0}
	showFunctionHall={data.functionHalls.length > 0}
	showDining={data.diningItems.length > 0 || (data.dining.menuImages ?? []).length > 0}
	showReviews={data.reviews.length > 0}
/>

<div class="storefront-section mx-auto max-w-4xl px-4 py-10 sm:px-6">
	<h1 class="storefront-section-title ledger-display text-3xl sm:text-4xl">Contact Us</h1>
	<p class="storefront-section-lede mt-2">Reach {data.hotel.name} directly — no middleman.</p>

	{#if hasAnyContactInfo}
		<div class="storefront-contact-details mt-8">
			{#if data.branding.contactAddress}
				<div class="storefront-contact-row">
					<MapPinIcon aria-hidden="true" />
					<span>{data.branding.contactAddress}</span>
				</div>
			{/if}
			{#if data.branding.contactPhone}
				<div class="storefront-contact-row">
					<PhoneIcon aria-hidden="true" />
					<a href="tel:{data.branding.contactPhone}">{data.branding.contactPhone}</a>
				</div>
			{/if}
			{#if data.branding.contactEmail}
				<div class="storefront-contact-row">
					<MailIcon aria-hidden="true" />
					<a href="mailto:{data.branding.contactEmail}">{data.branding.contactEmail}</a>
				</div>
			{/if}
		</div>
	{:else}
		<p class="storefront-section-lede mt-8">Contact details are coming soon.</p>
	{/if}

	{#if mapSrc}
		<div class="storefront-contact-map mt-8">
			<iframe
				title="Map to {data.hotel.name}"
				src={mapSrc}
				loading="lazy"
				referrerpolicy="no-referrer-when-downgrade"
			></iframe>
		</div>
	{/if}
</div>
