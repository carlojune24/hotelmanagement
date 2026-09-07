<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { amenityIcon } from '$lib/amenity-icons';
	import { AMENITY_CATEGORY_LABELS, AMENITY_CATEGORY_ORDER } from '$lib/amenity-categories';
	import BedIcon from '@lucide/svelte/icons/bed';
	import UsersIcon from '@lucide/svelte/icons/users';
	import RulerIcon from '@lucide/svelte/icons/ruler';
	import ImageIcon from '@lucide/svelte/icons/image';
	import StarIcon from '@lucide/svelte/icons/star';
	import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
	import CalendarCheckIcon from '@lucide/svelte/icons/calendar-check';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import InfoIcon from '@lucide/svelte/icons/info';
	import ReceiptIcon from '@lucide/svelte/icons/receipt';
	import { getContext } from 'svelte';
	import type { CartStore } from '$lib/cart.svelte';
	import type { BedConfigEntry } from '$lib/server/db/schema/inventory';
	import type { HallPriceBreakdown } from '$lib/server/pricing';
	import StorefrontNav from '$lib/components/storefront/storefront-nav.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const cart = getContext<CartStore>('cart');

	// No "add to invoice, then separately open the floating invoice" step for halls —
	// booking commits and takes the guest straight into the same guest-info → review →
	// payment → confirmation wizard rooms already use, same as clicking "Continue" in the
	// Booking Summary Sidebar does for a room. The cart already carries anything else the
	// guest added (a room from Rooms & Rates) into that same order.
	function bookHall(hallId: string, hallName: string) {
		const f = hallForms[hallId];
		if (!f?.quote || !f.eventDate) return;
		cart.addHall({
			functionHallId: hallId,
			hallName,
			eventDate: f.eventDate,
			startTime: f.startTime,
			endTime: addHours(f.startTime, f.hours),
			eventType: f.eventType,
			guestCount: f.guestCount,
			price: f.quote
		});
		goto(`/${data.hotel.slug}/book/details`);
	}

	const peso = (centavos: number) =>
		`₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

	let promo = $state(data.promo ?? '');

	const coverPhoto = (photos: { url: string; tag: string }[] | undefined) =>
		photos?.find((p) => p.tag === 'cover')?.url ?? photos?.[0]?.url ?? null;

	const startingPrice = $derived(
		data.browsableRoomTypes
			.map((rt) => rt.startingPriceCentavos)
			.filter((p): p is number => p != null)
			.reduce((min: number | null, p) => (min == null || p < min ? p : min), null)
	);

	const galleryImages = $derived(
		[
			...(data.branding.galleryImages ?? []),
			...data.browsableRoomTypes.flatMap((rt) => rt.photos.map((p) => p.url))
		]
			.filter((url, i, arr) => arr.indexOf(url) === i)
			.slice(0, 12)
	);

	const bedConfigText = (entries: BedConfigEntry[]) =>
		entries.map((e) => `${e.quantity} ${e.type}`).join(' + ');

	const groupedAmenities = $derived.by(() => {
		const byCategory = new Map<string, typeof data.hotelAmenities>();
		for (const a of data.hotelAmenities) {
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

	let lightboxSrc = $state<string | null>(null);

	/** A room/gallery photo that fails to load (fake seed URLs, a stale hotel-set link) hides
	    itself so the woven-pattern placeholder underneath shows through — never a broken-image icon. */
	function hidePhoto(e: Event) {
		(e.currentTarget as HTMLImageElement).style.display = 'none';
	}

	// Function Hall reservation mini-form — one state slot per hall. Hourly math never
	// happens here: every quote is a real server round-trip to `/hall-quote`.
	interface HallFormState {
		eventDate: string;
		startTime: string;
		hours: number;
		guestCount: number;
		eventType: string;
		quote: HallPriceBreakdown | null;
		quoteError: string | null;
		loading: boolean;
	}
	const hallForms = $state<Record<string, HallFormState>>(
		Object.fromEntries(
			data.functionHalls.map((h) => [
				h.id,
				{
					eventDate: '',
					startTime: '09:00',
					hours: h.baseHours,
					guestCount: Math.min(2, h.capacity),
					eventType: h.supportedEventTypes[0] ?? '',
					quote: null,
					quoteError: null,
					loading: false
				} satisfies HallFormState
			])
		)
	);

	function addHours(time: string, hours: number): string {
		const [h, m] = time.split(':').map(Number);
		const total = ((h! * 60 + m! + hours * 60) % (24 * 60) + 24 * 60) % (24 * 60);
		return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
	}

	async function fetchHallQuote(hallId: string) {
		const f = hallForms[hallId];
		if (!f) return;
		f.loading = true;
		f.quoteError = null;
		try {
			const res = await fetch(`/${data.hotel.slug}/book/api/hall-quote`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					functionHallId: hallId,
					startTime: f.startTime,
					endTime: addHours(f.startTime, f.hours)
				})
			});
			if (!res.ok) {
				f.quote = null;
				f.quoteError =
					((await res.json().catch(() => null)) as { message?: string } | null)?.message ??
					'Could not price that booking.';
				return;
			}
			f.quote = await res.json();
		} catch {
			f.quote = null;
			f.quoteError = 'Could not reach the server. Try again.';
		} finally {
			f.loading = false;
		}
	}

</script>

<svelte:head>
	<title>{data.hotel.name} — Book your stay</title>
</svelte:head>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') lightboxSrc = null;
	}}
/>

<StorefrontNav
	hotelSlug={data.hotel.slug}
	hotelName={data.hotel.name}
	logoUrl={data.branding.logoUrl}
	showAmenities={data.hotelAmenities.length > 0}
	showFunctionHall={data.functionHalls.length > 0}
	showDining={data.diningItems.length > 0 || (data.dining.menuImages ?? []).length > 0}
	showReviews={data.reviews.length > 0}
	transparentOverHero={Boolean(data.branding.heroVideoUrl || data.branding.heroImageUrl)}
/>

<div id="top"></div>

<section
	class="storefront-hero {data.branding.heroVideoUrl || data.branding.heroImageUrl
		? 'has-media'
		: 'ledger-woven-band'}"
>
	{#if data.branding.heroVideoUrl}
		<div class="storefront-hero-photo">
			<!-- svelte-ignore a11y_media_has_caption -->
			<video
				src={data.branding.heroVideoUrl}
				poster={data.branding.heroImageUrl ?? undefined}
				autoplay
				muted
				loop
				playsinline
				class="brightness-75"
			></video>
		</div>
		<div class="storefront-hero-scrim"></div>
		{#if galleryImages.length > 0}
			<button
				type="button"
				class="storefront-hero-gallery-cta"
				onclick={() => (lightboxSrc = galleryImages[0]!)}
			>
				<ImageIcon aria-hidden="true" />
				See the gallery
			</button>
		{/if}
	{:else if data.branding.heroImageUrl}
		<div class="storefront-hero-photo">
			<img
				src={data.branding.heroImageUrl}
				alt=""
				onerror={hidePhoto}
				class="brightness-75"
			/>
		</div>
		<div class="storefront-hero-scrim"></div>
		{#if galleryImages.length > 0}
			<button
				type="button"
				class="storefront-hero-gallery-cta"
				onclick={() => (lightboxSrc = galleryImages[0]!)}
			>
				<ImageIcon aria-hidden="true" />
				See the gallery
			</button>
		{/if}
	{/if}
	<div class="storefront-hero-inner">
		<p class="ledger-label">Welcome to {data.hotel.name}</p>
		<h1 class="ledger-display mt-2 text-4xl sm:text-[clamp(2.25rem,5vw,3.5rem)]">
			{data.branding.tagline ?? data.hotel.name}
		</h1>
		{#if startingPrice != null}
			<p class="ledger-label mt-6">
				Rates from <span class="ledger-data text-sm">{peso(startingPrice)}</span> / night
			</p>
		{/if}
	</div>
</section>

<div id="search" class="storefront-search-dock">
	<div class="storefront-search-dock-panel">
		<form
			method="GET"
			action="book/rooms"
			class="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
		>
			<div>
				<Label for="checkIn" class="ledger-label">Arrival date</Label>
				<Input id="checkIn" name="checkIn" type="date" required class="ledger-field mt-1" />
			</div>
			<div>
				<Label for="checkOut" class="ledger-label">Departure date</Label>
				<Input id="checkOut" name="checkOut" type="date" required class="ledger-field mt-1" />
			</div>
			<div>
				<Label for="promo" class="ledger-label">Promo code</Label>
				<Input
					id="promo"
					name="promo"
					type="text"
					placeholder="Code here"
					bind:value={promo}
					class="ledger-field mt-1"
				/>
			</div>
			<Button type="submit" class="ledger-btn-primary">Check availability</Button>
		</form>
	</div>
</div>

{#if data.branding.about || data.hotel.city}
	{@const aboutPhoto = data.branding.galleryImages?.[0] ?? data.branding.heroImageUrl ?? null}
	<section id="about" class="storefront-section">
		<div class="storefront-about-grid {aboutPhoto ? 'has-photo' : ''}">
			<div>
				<div class="storefront-section-head">
					<h2 class="storefront-section-title ledger-display text-2xl sm:text-3xl">
						About {data.hotel.name}
					</h2>
					{#if data.hotel.city}
						<p class="ledger-label mt-2">{data.hotel.city}, Philippines</p>
					{/if}
				</div>
				{#if data.branding.about}
					<p class="storefront-section-lede text-[0.9375rem] leading-relaxed">
						{data.branding.about}
					</p>
				{/if}
			</div>
			{#if aboutPhoto}
				<div class="storefront-about-photo">
					<img src={aboutPhoto} alt="" onerror={hidePhoto} />
				</div>
			{/if}
		</div>
	</section>
{/if}

{#if groupedAmenities.length > 0}
	<section id="amenities" class="storefront-section">
		<div class="storefront-section-head">
			<h2 class="storefront-section-title ledger-display text-2xl sm:text-3xl">Amenities</h2>
		</div>
		<p class="storefront-section-lede">Everything included in your stay.</p>

		<div class="storefront-amenity-columns">
			{#each groupedAmenities as group (group.category)}
				<div class="storefront-amenity-column">
					<h3 class="storefront-amenity-group-head storefront-section-title">{group.label}</h3>
					<ul class="storefront-amenity-list">
						{#each group.items as a (a.name)}
							{@const Icon = amenityIcon(a.icon)}
							<li class="storefront-amenity-item">
								<Icon aria-hidden="true" />
								<span>{a.name}</span>
								{#if a.note}<span class="storefront-amenity-note">— {a.note}</span>{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</div>
	</section>
{/if}

<section id="rooms" class="storefront-section">
	<div class="storefront-section-head">
		<h2 class="storefront-section-title ledger-display text-2xl sm:text-3xl">Rooms &amp; Rates</h2>
	</div>
	<p class="storefront-section-lede">
		Indicative starting rates below — pick your dates above for live availability and an exact
		price.
	</p>

	{#if data.browsableRoomTypes.length === 0}
		<p class="storefront-section-lede">Room types are being set up — check back shortly.</p>
	{:else}
		<div class="storefront-room-grid mt-8">
			{#each data.browsableRoomTypes as rt (rt.id)}
				{@const cover = coverPhoto(rt.photos)}
				<a href="book/rooms/{rt.id}" class="storefront-room-card">
					<div class="storefront-room-card-photo">
						<span class="ledger-room-photo-mark">{rt.name.charAt(0)}</span>
						{#if cover}<img src={cover} alt="" onerror={hidePhoto} />{/if}
						<div class="storefront-room-card-scrim"></div>
						<div class="storefront-room-card-overlay">
							<div class="storefront-room-card-name">{rt.name}</div>
							<div class="storefront-room-card-rule"></div>
							<div class="storefront-room-card-row">
								<div class="storefront-room-card-glance">
									{#if rt.bedConfiguration.length > 0}
										<span class="storefront-glance-item">
											<BedIcon aria-hidden="true" />
											<span>{bedConfigText(rt.bedConfiguration)}</span>
										</span>
									{/if}
									<span class="storefront-glance-item">
										<UsersIcon aria-hidden="true" />
										<span>{rt.maxOccupancy}</span>
									</span>
									{#if rt.sizeSqm}
										<span class="storefront-glance-item">
											<RulerIcon aria-hidden="true" />
											<span>{rt.sizeSqm} m²</span>
										</span>
									{/if}
								</div>
								<div class="storefront-room-card-cta">
									{#if rt.startingPriceCentavos != null}
										<span class="ledger-data">from {peso(rt.startingPriceCentavos)}/night</span>
									{/if}
									<span class="storefront-room-card-details">Details →</span>
								</div>
							</div>
						</div>
					</div>
				</a>
			{/each}
		</div>
	{/if}
</section>

{#if data.functionHalls.length > 0}
	<section id="function-hall" class="storefront-section">
		<div class="storefront-section-head">
			<h2 class="storefront-section-title ledger-display text-2xl sm:text-3xl">Function Hall</h2>
			<p class="storefront-section-lede">
				Rent our event space by the hour — weddings, seminars, celebrations, and more.
			</p>
		</div>
		<div class="mt-8 space-y-8">
			{#each data.functionHalls as hall (hall.id)}
				{@const cover = coverPhoto(hall.photos)}
				{@const f = hallForms[hall.id]}
				<div class="storefront-hall-card">
					<div class="storefront-hall-card-top">
						<div class="storefront-hall-card-photo">
							<span class="ledger-room-photo-mark">{hall.name.charAt(0)}</span>
							{#if cover}<img src={cover} alt="" onerror={hidePhoto} />{/if}
						</div>
						<div class="storefront-hall-card-body">
							<div>
								<div class="ledger-display text-xl">{hall.name}</div>
								{#if hall.description}
									<p class="mt-0.5 max-w-md text-sm text-[var(--ledger-ink-muted)]">
										{hall.description}
									</p>
								{/if}
								{#if hall.includedServices.length > 0}
									<div class="storefront-hall-facts">
										{#each hall.includedServices as service (service)}
											<span class="storefront-hall-fact">
												<CircleCheckIcon aria-hidden="true" />
												<span>{service}</span>
											</span>
										{/each}
									</div>
								{/if}
								<p class="mt-2 text-xs text-[var(--ledger-ink-muted)]">
									Up to <span class="ledger-data">{hall.capacity}</span> guests
								</p>
								{#if hall.supportedEventTypes.length > 0}
									<p class="mt-1 text-xs text-[var(--ledger-ink-muted)]">
										For: {hall.supportedEventTypes.join(', ')}
									</p>
								{/if}
								<a
									href="book/meetings-events#hall-{hall.id}"
									class="storefront-view-details-btn"
								>
									View full details →
								</a>
							</div>
							<div class="storefront-hall-card-price">
								<span class="ledger-label">Starting from</span>
								<div class="ledger-data text-xl">
									{peso(hall.basePriceCentavos)} / {hall.baseHours}h
								</div>
								<span class="ledger-label">+ {peso(hall.extraHourFeeCentavos)}/hr after</span>
							</div>
						</div>
					</div>

					{#if f}
						<div class="storefront-hall-form-zone">
							<h3 class="storefront-hall-panel-head">
								<CalendarDaysIcon aria-hidden="true" />
								Event Details
							</h3>
							<div class="storefront-hall-details-grid">
								<div>
									<Label for="eventDate-{hall.id}" class="ledger-label">Event date</Label>
									<Input
										id="eventDate-{hall.id}"
										type="date"
										class="storefront-hall-field mt-1"
										bind:value={f.eventDate}
										onchange={() => fetchHallQuote(hall.id)}
									/>
								</div>
								<div>
									<Label for="startTime-{hall.id}" class="ledger-label">Start time</Label>
									<Input
										id="startTime-{hall.id}"
										type="time"
										class="storefront-hall-field mt-1"
										bind:value={f.startTime}
										onchange={() => fetchHallQuote(hall.id)}
									/>
								</div>
								<div>
									<Label for="hours-{hall.id}" class="ledger-label">Duration (hours)</Label>
									<Input
										id="hours-{hall.id}"
										type="number"
										min="1"
										max="15"
										class="storefront-hall-field mt-1"
										bind:value={f.hours}
										onchange={() => fetchHallQuote(hall.id)}
									/>
								</div>
								<div>
									<Label for="guestCount-{hall.id}" class="ledger-label">Guests</Label>
									<Input
										id="guestCount-{hall.id}"
										type="number"
										min="1"
										max={hall.capacity}
										class="storefront-hall-field mt-1"
										bind:value={f.guestCount}
									/>
								</div>
								{#if hall.supportedEventTypes.length > 0}
									<div>
										<Label for="eventType-{hall.id}" class="ledger-label">Event type</Label>
										<select
											id="eventType-{hall.id}"
											class="storefront-hall-field mt-1"
											bind:value={f.eventType}
										>
											{#each hall.supportedEventTypes as et (et)}
												<option value={et}>{et}</option>
											{/each}
										</select>
									</div>
								{/if}
							</div>

							<div class="storefront-hall-status">
								{#if f.loading}
									<p class="text-xs text-[var(--ledger-ink-muted)]">Pricing…</p>
								{:else if f.quoteError}
									<p class="text-xs" style="color: var(--ledger-danger, #b91c1c);">
										{f.quoteError}
									</p>
								{:else if f.quote}
									<div class="storefront-hall-summary-row">
										<div class="storefront-hall-panel">
											<h3 class="storefront-hall-panel-head">
												<ReceiptIcon aria-hidden="true" />
												Quotation Summary
											</h3>
											<div class="storefront-hall-quote">
												<div class="storefront-hall-quote-row">
													<span>Base ({f.quote.baseHours}h)</span>
													<span class="ledger-data">{peso(f.quote.basePriceCentavos)}</span>
												</div>
												{#if f.quote.extraHours > 0}
													<div class="storefront-hall-quote-row">
														<span
															>Extra {f.quote.extraHours}h × {peso(
																f.quote.extraHourFeeCentavos
															)}</span
														>
														<span class="ledger-data">{peso(f.quote.extraHoursCostCentavos)}</span>
													</div>
												{/if}
												{#each f.quote.fees as fee (fee.name)}
													<div class="storefront-hall-quote-row">
														<span>{fee.name}</span>
														<span class="ledger-data">{peso(fee.amountCentavos)}</span>
													</div>
												{/each}
												<div class="storefront-hall-quote-row">
													<span>VAT</span>
													<span class="ledger-data">{peso(f.quote.vatCentavos)}</span>
												</div>
												<div class="storefront-hall-quote-row is-total">
													<span>Total</span>
													<span class="ledger-data text-base">{peso(f.quote.totalCentavos)}</span>
												</div>
											</div>
										</div>
										<div class="storefront-hall-note">
											<InfoIcon aria-hidden="true" />
											<div>
												<span class="storefront-hall-note-head">Note</span>
												<p>
													Additional hours will be charged at {peso(hall.extraHourFeeCentavos)} per hour
													after the initial {hall.baseHours} hours.
												</p>
											</div>
										</div>
									</div>
									{#if f.eventDate}
										<Button
											type="button"
											class="ledger-btn-primary storefront-hall-cta"
											onclick={() => bookHall(hall.id, hall.name)}
										>
											<CalendarCheckIcon aria-hidden="true" />
											Check Availability
										</Button>
										<p class="mt-2 text-center text-xs text-[var(--ledger-ink-muted)]">
											We'll confirm your booking details and availability.
										</p>
									{:else}
										<p class="text-xs text-[var(--ledger-ink-muted)]">
											Pick an event date to check availability.
										</p>
									{/if}
								{:else}
									<p class="text-xs text-[var(--ledger-ink-muted)]">
										Pick a date and time to see pricing.
									</p>
								{/if}
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</section>
{/if}

{#if galleryImages.length > 0}
	<section id="gallery" class="storefront-section">
		<div class="storefront-section-head">
			<h2 class="storefront-section-title ledger-display text-2xl sm:text-3xl">Gallery</h2>
		</div>
		<div class="storefront-gallery-grid">
			{#each galleryImages as url, i (url)}
				<button
					type="button"
					class="storefront-gallery-item {i % 5 === 0 ? 'is-wide' : ''}"
					onclick={() => (lightboxSrc = url)}
					aria-label="View larger photo"
				>
					<img src={url} alt="" loading="lazy" onerror={hidePhoto} />
				</button>
			{/each}
		</div>
	</section>
{/if}

{#if data.reviews.length > 0}
	<section id="reviews" class="storefront-section">
		<div class="storefront-section-head">
			<h2 class="storefront-section-title ledger-display text-2xl sm:text-3xl">What guests say</h2>
		</div>
		<div class="storefront-reviews-grid">
			{#each data.reviews as r (r.guestDisplayName + r.submittedAt)}
				<div class="storefront-review">
					<div class="storefront-review-stars">
						{#each Array(5) as _, i (i)}
							<StarIcon
								class="size-3.5 {i < r.rating
									? 'fill-current text-[var(--hotel-accent)]'
									: 'text-[var(--ledger-rule)]'}"
							/>
						{/each}
					</div>
					<p class="mt-2 text-sm text-[var(--ledger-ink)]">{r.comment}</p>
					<p class="mt-2 ledger-label">{r.guestDisplayName}</p>
				</div>
			{/each}
		</div>
	</section>
{/if}

<footer class="storefront-footer">
	<div class="storefront-footer-inner">
		<div>
			<div class="ledger-display text-lg">{data.hotel.name}</div>
			{#if data.hotel.city}
				<p class="mt-1 text-sm text-[var(--ledger-ink-muted)]">{data.hotel.city}, Philippines</p>
			{/if}
			<p class="mt-3 max-w-sm text-sm text-[var(--ledger-ink-muted)]">
				Booked directly with the hotel — the price you see on review is the price you pay, no
				third-party markup.
			</p>
		</div>
		<Button href="#search" class="ledger-btn-primary">Check availability</Button>
	</div>
</footer>

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
