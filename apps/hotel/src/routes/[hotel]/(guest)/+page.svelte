<script lang="ts">
	import { guestBase } from '$lib/guest-base';
	import { goto } from '$app/navigation';
	import { getContext, onMount } from 'svelte';
	import { AMENITY_CATEGORY_LABELS, AMENITY_CATEGORY_ORDER } from '$lib/amenity-categories';
	import { DEFAULT_DISPLAY_FONT, DISPLAY_FONTS } from '$lib/branding';
	import { roomCartItem } from '$lib/room-line';
	import { formatStayDateShort, nightsLabel } from '$lib/stay-dates';
	import ImageIcon from '@lucide/svelte/icons/image';
	import StarIcon from '@lucide/svelte/icons/star';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CalendarCheckIcon from '@lucide/svelte/icons/calendar-check';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import type { CartStore } from '$lib/cart.svelte';
	import type { AvailableRatePlan, AvailableRoomType, BrowsableRoomType } from '$lib/server/availability';
	import type { HallPriceBreakdown } from '$lib/server/pricing';
	import StorefrontNav from '$lib/components/storefront/storefront-nav.svelte';
	import StorefrontFooter from '$lib/components/storefront/storefront-footer.svelte';
	import StorefrontLightbox from '$lib/components/storefront/storefront-lightbox.svelte';
	import BookingBar from '$lib/components/storefront/booking-bar.svelte';
	import RoomCard from '$lib/components/storefront/room-card.svelte';
	import RoomQuickView from '$lib/components/storefront/room-quick-view.svelte';
	import { brandBothWays, brandName, canonicalUrl, homeTitle, hotelJsonLd, spacedName } from '$lib/seo';
	import { page } from '$app/state';
	import type { PageData } from './$types';
	const base = $derived(guestBase(page));

	let { data }: { data: PageData } = $props();

	const cart = getContext<CartStore>('cart');

	// The stay in the booking bar. A searched stay (in the URL) seeds it and re-seeds it on back/forward.
	let checkIn = $state('');
	let checkOut = $state('');
	let adults = $state(2);
	let children = $state(0);
	$effect(() => {
		if (data.stay) {
			checkIn = data.stay.checkIn;
			checkOut = data.stay.checkOut;
			adults = data.stay.adults;
			children = data.stay.children;
		}
	});

	const slug = $derived(data.hotel.slug);
	const peso = (centavos: number) =>
		`₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
	const hotelMedia = $derived(Boolean(data.branding.heroVideoUrl || data.branding.heroImageUrl));

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

	const amenityGroups = $derived.by(() => {
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

	// ---- live rooms for the searched stay
	const liveById = $derived(new Map(data.liveRooms.map((r) => [r.id, r])));
	const search = $derived(
		data.stay ? { checkIn: data.stay.checkIn, checkOut: data.stay.checkOut, nights: data.stay.nights } : null
	);
	const stayQuery = $derived(
		data.stay
			? `?${new URLSearchParams({
					checkIn: data.stay.checkIn,
					checkOut: data.stay.checkOut,
					adults: String(data.stay.adults),
					children: String(data.stay.children)
				})}`
			: ''
	);
	const availableCount = $derived(data.liveRooms.length);

	function reserve(room: AvailableRoomType, plan: AvailableRatePlan) {
		if (!data.stay) return;
		cart.addRoom(
			roomCartItem({
				roomType: room,
				plan,
				checkIn: data.stay.checkIn,
				checkOut: data.stay.checkOut,
				occupancy: data.stay.adults + data.stay.children,
				roomCount: 1,
				vatRateBps: data.hotel.vatRateBps
			})
		);
		void goto(`${base}/details`);
	}

	/** A room card's own "Check dates & price": same search as the booking bar, then back to THAT room. */
	async function searchForRoom(roomId: string) {
		if (!checkIn || !checkOut) return;
		const q = new URLSearchParams({
			checkIn,
			checkOut,
			adults: String(adults),
			children: String(children)
		});
		await goto(`${base || '/'}?${q}`, { keepFocus: true, noScroll: true, invalidateAll: true });
		document.getElementById(`room-${roomId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	/** Opens the booking bar's calendar — the docked bar in the hero, or the sticky one once scrolled. */
	function pickDates() {
		// Let the quick-view sheet finish closing first, so it doesn't swallow the calendar's focus.
		const delay = qvOpen ? 300 : 0;
		qvOpen = false;
		setTimeout(() => document.querySelector<HTMLButtonElement>('.sf-bar .trigger')?.click(), delay);
	}

	// ---- quick view
	let qvOpen = $state(false);
	let qvRoom = $state<BrowsableRoomType | null>(null);
	function openQuickView(room: BrowsableRoomType) {
		qvRoom = room;
		qvOpen = true;
	}
	const fontFamily = $derived(DISPLAY_FONTS[data.branding.fontDisplay ?? DEFAULT_DISPLAY_FONT].family);
	const sheetTheme = $derived(
		`--hotel-accent: ${data.theme.accent}; --hotel-accent-light: ${data.theme.accentLight}; ` +
			`--hotel-accent-deep: ${data.theme.accentDeep}; --hotel-woven-pattern: url("${data.theme.patternUri}"); ` +
			`--ledger-paper: ${data.theme.paper}; --ledger-paper-2: ${data.theme.paperDeep}; ` +
			`--ledger-font-display: ${fontFamily};`
	);

	// ---- hero media. A data-saver or slow connection gets the poster image, not an autoplaying video.
	let allowHeroVideo = $state(true);
	onMount(() => {
		const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } })
			.connection;
		if (!conn) return;
		if (conn.saveData || conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g') allowHeroVideo = false;
	});

	let lightboxIndex = $state<number | null>(null);
	/** A photo that fails to load hides itself so the woven placeholder underneath shows, never a broken icon. */
	function hidePhoto(e: Event) {
		(e.currentTarget as HTMLImageElement).style.display = 'none';
	}

	/** The About body as readable paragraphs: the hotel's own blank-line breaks, or — for one long block —
	    sentences grouped into chunks of roughly 300 characters. */
	const aboutParagraphs = $derived.by(() => {
		const raw = data.branding.about?.trim();
		if (!raw) return [`Welcome to ${data.hotel.name}.`];
		const blocks = raw.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
		if (blocks.length > 1) return blocks;
		const out: string[] = [];
		let cur = '';
		for (const s of raw.split(/(?<=[.!?])\s+/)) {
			if (cur && cur.length + s.length > 340) {
				out.push(cur);
				cur = s;
			} else cur = cur ? `${cur} ${s}` : s;
		}
		if (cur) out.push(cur);
		return out;
	});
	/** The tagline for the About heading, with its last two words set apart to take the accent colour. */
	const tagline = $derived.by(() => {
		const words = data.branding.tagline?.trim().split(/\s+/) ?? [];
		if (words.length === 0 || words[0] === '') return null;
		if (words.length < 4) return { lead: words.join(' '), accent: '' };
		return { lead: words.slice(0, -2).join(' '), accent: words.slice(-2).join(' ') };
	});
	const aboutPhoto = $derived(data.branding.galleryImages?.[0] ?? data.branding.heroImageUrl ?? null);
	const diningFeature = $derived(data.diningItems[0] ?? null);
	const diningCover = $derived.by(() => {
		const photos = (diningFeature?.photos as { url: string; tag: string }[] | null) ?? [];
		return photos.find((p) => p.tag === 'cover')?.url ?? photos[0]?.url ?? null;
	});

	// ---- Function Hall reservation form — one state slot per hall. Hourly math never happens here:
	// every quote is a real server round-trip to `/hall-quote`.
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
			const res = await fetch(`/${slug}/api/hall-quote`, {
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

	// Booking commits and goes straight into the same guest-info → review → payment → confirmation flow
	// rooms use; the cart already carries anything else the guest added into that same order.
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
		void goto(`${base}/details`);
	}

	const brand = $derived(brandName(data.hotel.name, data.hotel.city));
	// Lead with the name people search for, then the hotel's own line.
	const description = $derived(
		`${brandBothWays(data.hotel.name, data.hotel.city)} — official website. ${data.branding.tagline ?? data.branding.heroSubtitle ?? 'Book direct for the best rates.'}`
	);
	const pageTitle = $derived(homeTitle(data.hotel.name, data.hotel.city));
	const homeUrl = $derived(
		canonicalUrl({ origin: page.url.origin, slug: data.hotel.slug, customDomain: data.hotel.customDomain, pathname: page.url.pathname })
	);
	const shareImage = $derived(
		data.branding.heroImageUrl ? new URL(data.branding.heroImageUrl, homeUrl).href : undefined
	);
	const jsonLd = $derived(
		hotelJsonLd({
			name: brand,
			alternateName: spacedName(brand) ?? undefined,
			url: homeUrl,
			city: data.hotel.city,
			address: data.branding.contactAddress,
			phone: data.branding.contactPhone,
			email: data.branding.contactEmail,
			image: shareImage,
			lat: data.branding.contactLat,
			lng: data.branding.contactLng,
			sameAs: [data.branding.facebookUrl, data.branding.instagramUrl, data.branding.tiktokUrl]
		})
	);
</script>

<svelte:head>
	<meta name="description" content={description} />
	<meta property="og:title" content={pageTitle} />
	<meta property="og:description" content={description} />
	{#if shareImage}<meta property="og:image" content={shareImage} />{/if}
	{@html `<script type="application/ld+json">${jsonLd}</script>`}
</svelte:head>

<StorefrontNav
	hotelSlug={slug}
	hotelName={data.hotel.name}
	logoUrl={data.branding.logoUrl}
	showAmenities={data.hotelAmenities.length > 0}
	showFunctionHall={data.functionHalls.length > 0}
	showDining={data.diningItems.length > 0 || (data.dining.menuImages ?? []).length > 0}
	showReviews={data.reviews.length > 0}
	transparentOverHero={hotelMedia}
	accent={data.theme.accent}
	accentDeep={data.theme.accentDeep}
	paper={data.theme.paper}
	paperDeep={data.theme.paperDeep}
/>

<main>
	<!-- ============================ Hero ============================ -->
	<section id="top" class="sf-hero is-home" class:no-media={!hotelMedia}>
		{#if hotelMedia}
			<div class="sf-hero-media">
				{#if data.branding.heroVideoUrl && allowHeroVideo}
					<!-- svelte-ignore a11y_media_has_caption -->
					<video
						src={data.branding.heroVideoUrl}
						poster={data.branding.heroImageUrl ?? undefined}
						autoplay
						muted
						loop
						playsinline
					></video>
				{:else if data.branding.heroImageUrl}
					<img src={data.branding.heroImageUrl} alt="" onerror={hidePhoto} />
				{/if}
			</div>
			<div class="sf-hero-scrim"></div>
		{/if}

		{#if galleryImages.length > 0}
			<div class="sf-hero-photos">
				<button type="button" class="sf-btn sf-btn--light sf-btn--sm" onclick={() => (lightboxIndex = 0)}>
					<ImageIcon class="size-4" aria-hidden="true" /> Photos
				</button>
			</div>
		{/if}

		<div class="sf-wrap sf-hero-content">
			<h1>{data.hotel.name}</h1>
			{#if data.branding.tagline}<p class="sf-hero-tag">{data.branding.tagline}</p>{/if}
			{#if data.branding.heroSubtitle}<p class="sf-hero-tag" style="margin-top: 0.75rem; font-size: 1rem">{data.branding.heroSubtitle}</p>{/if}
			{#if startingPrice != null}
				<p class="sf-hero-from">Rooms from <b>{peso(startingPrice)}</b> / night</p>
			{/if}
		</div>

		<div id="search" class="sf-wrap sf-hero-bar-slot">
			<BookingBar
				hotelSlug={slug}
				days={data.dayAvailability}
				today={data.today}
				bind:checkIn
				bind:checkOut
				bind:adults
				bind:children
			/>
		</div>
	</section>

	<!-- ============================ About ============================ -->
	{#if data.branding.about || data.hotel.city}
		<section id="about" class="sf-section">
			<div class="sf-wrap sf-about" class:has-photo={Boolean(aboutPhoto)}>
				<div class="sf-about-copy">
					<p class="sf-eyebrow"><span aria-hidden="true"></span>About us</p>
					<h2 class="sf-about-head">
						<span class="sf-about-kicker">Discover {data.hotel.name}</span>
						{#if tagline}
							<span class="sf-about-title">{tagline.lead}{#if tagline.accent}&nbsp;<em>{tagline.accent}</em>{/if}</span>
						{/if}
					</h2>
					{#each aboutParagraphs as para, i (i)}
						<p class="sf-about-text" class:has-dropcap={i === 0 && para.length > 80}>{para}</p>
					{/each}
					{#if data.hotel.city}<p class="sf-about-place">{data.hotel.city}, Philippines</p>{/if}
					<div class="sf-feature-actions">
						<a href="#rooms" class="sf-btn">See rooms &amp; rates</a>
						<a href="{base}/contact" class="sf-link">Find us <ArrowRightIcon class="size-4" aria-hidden="true" /></a>
					</div>
				</div>
				{#if aboutPhoto}
					<div class="sf-about-photo"><img src={aboutPhoto} alt="" loading="lazy" onerror={hidePhoto} /></div>
				{/if}
			</div>
		</section>
	{/if}

	<!-- ============================ Rooms ============================ -->
	<section id="rooms" class="sf-section" class:sf-section--tint={Boolean(data.branding.about || data.hotel.city)}>
		<div class="sf-wrap">
			<div class="sf-head">
				<div>
					<h2 class="sf-h2">Rooms &amp; Rates</h2>
					<p class="sf-lede">
						{#if search}
							{availableCount > 0
								? `${availableCount} room type${availableCount === 1 ? '' : 's'} available for your stay. Prices are for the whole stay, taxes and fees included.`
								: 'Nothing is open for those dates. Try different dates and we will show what is.'}
						{:else}
							Choose a room to see what is included. Pick your dates above for live availability and the exact price.
						{/if}
					</p>
				</div>
			</div>

			{#if search}
				<div class="sf-stay-note">
					<CalendarCheckIcon class="size-5 text-[var(--hotel-accent)]" aria-hidden="true" />
					<span>
						<b>{formatStayDateShort(search.checkIn)}</b> → <b>{formatStayDateShort(search.checkOut)}</b>
						· {nightsLabel(search.nights)} · {data.stay!.adults} adult{data.stay!.adults === 1 ? '' : 's'}{data.stay!.children > 0 ? `, ${data.stay!.children} child${data.stay!.children === 1 ? '' : 'ren'}` : ''}
					</span>
					<button type="button" class="sf-link" onclick={pickDates}>Change</button>
				</div>
			{/if}

			{#if data.browsableRoomTypes.length === 0}
				<p class="sf-lede">Room types are being set up — check back shortly.</p>
			{:else}
				<div class="sf-rooms">
					{#each data.browsableRoomTypes as rt (rt.id)}
						<RoomCard
							room={rt}
							hotelSlug={slug}
							vatRateBps={data.hotel.vatRateBps}
							{search}
							live={liveById.get(rt.id) ?? null}
							stockTonight={data.stockByRoomType[rt.id] ?? null}
							days={data.dayAvailabilityByRoomType[rt.id] ?? data.dayAvailability}
							today={data.today}
							bind:checkIn
							bind:checkOut
							bind:adults
							bind:children
							onSearch={() => searchForRoom(rt.id)}
							{stayQuery}
							onQuickView={openQuickView}
							onReserve={reserve}
						/>
					{/each}
				</div>
			{/if}
		</div>
	</section>

	<!-- ============================ Amenities ============================ -->
	{#if amenityGroups.length > 0}
		<section id="amenities" class="sf-section sf-section--night">
			<div class="sf-wrap sf-amen">
				<div>
					<h2 class="sf-h2" style="color: var(--sf-on-night)">Everything is taken care of</h2>
					<p class="sf-lede">What is included with your stay at {data.hotel.name}.</p>
				</div>
				<div class="sf-amen-groups">
					{#each amenityGroups as group (group.category)}
						<div class="sf-amen-group">
							<h3>{group.label}</h3>
							<ul>
								{#each group.items as a (a.name)}
									<li>
										{a.name}
										{#if a.note}<small>{a.note}</small>{/if}
									</li>
								{/each}
							</ul>
						</div>
					{/each}
				</div>
			</div>
		</section>
	{/if}

	<!-- ============================ Dining ============================ -->
	{#if diningFeature}
		<section id="dining" class="sf-section">
			<div class="sf-wrap sf-feature">
				<div class="sf-feature-media">
					{#if diningCover}<img src={diningCover} alt="" loading="lazy" onerror={hidePhoto} />{/if}
				</div>
				<div>
					<h2 class="sf-h2">{diningFeature.title}</h2>
					{#if diningFeature.tagline}<p class="sf-lede">{diningFeature.tagline}</p>{/if}
					{#if diningFeature.operatingHours}
						<p class="sf-lede" style="margin-top: 0.75rem; font-size: 0.9375rem">Open {diningFeature.operatingHours}</p>
					{/if}
					<div class="sf-feature-actions">
						<a href="{base}/dining" class="sf-btn">View the menu</a>
						{#if diningFeature.reservationsEnabled}
							<a href="{base}/dining/reserve?venue={diningFeature.id}" class="sf-btn sf-btn--outline">Reserve a table</a>
						{/if}
						{#if data.orderableVenueIds.includes(diningFeature.id)}
							<a href="{base}/dining/order?venue={diningFeature.id}" class="sf-link">Order online <ArrowRightIcon class="size-4" aria-hidden="true" /></a>
						{/if}
					</div>
				</div>
			</div>
		</section>
	{/if}

	<!-- ============================ Function hall ============================ -->
	{#if data.functionHalls.length > 0}
		<section id="function-hall" class="sf-section sf-section--tint">
			<div class="sf-wrap">
				<div class="sf-head">
					<div>
						<h2 class="sf-h2">Weddings, meetings &amp; celebrations</h2>
						<p class="sf-lede">Rent our event space by the hour. Pick a date and time and the price is worked out for you.</p>
					</div>
					<a href="{base}/meetings-events" class="sf-link">All event details <ArrowRightIcon class="size-4" aria-hidden="true" /></a>
				</div>

				{#each data.functionHalls as hall (hall.id)}
					{@const cover = coverPhoto(hall.photos)}
					{@const f = hallForms[hall.id]}
					<div class="sf-hall">
						<div class="sf-hall-top">
							<div class="sf-hall-photo">
								{#if cover}<img src={cover} alt="" loading="lazy" onerror={hidePhoto} />{/if}
							</div>
							<div class="sf-hall-body">
								<h3>{hall.name}</h3>
								{#if hall.description}<p class="line-clamp-4">{hall.description}</p>{/if}
								<div class="sf-hall-meta">
									<span>Up to {hall.capacity} guests</span>
									{#if hall.supportedEventTypes.length > 0}<span>{hall.supportedEventTypes.join(', ')}</span>{/if}
								</div>
								{#if hall.includedServices.length > 0}
									<div class="sf-hall-meta">
										{#each hall.includedServices as service (service)}
											<span class="inline-flex items-center gap-1.5">
												<CircleCheckIcon class="size-4 text-[var(--hotel-accent)]" aria-hidden="true" />{service}
											</span>
										{/each}
									</div>
								{/if}
								<div class="sf-hall-price">
									<span>From</span>
									<b>{peso(hall.basePriceCentavos)}</b>
									<span>/ {hall.baseHours}h · then {peso(hall.extraHourFeeCentavos)}/hr</span>
								</div>
							</div>
						</div>

						{#if f}
							<div class="sf-hall-form">
								<h4>Plan your event</h4>
								<div class="sf-hall-grid">
									<div>
										<label for="eventDate-{hall.id}">Event date</label>
										<input id="eventDate-{hall.id}" type="date" min={data.today} bind:value={f.eventDate} onchange={() => fetchHallQuote(hall.id)} />
									</div>
									<div>
										<label for="startTime-{hall.id}">Start time</label>
										<input id="startTime-{hall.id}" type="time" bind:value={f.startTime} onchange={() => fetchHallQuote(hall.id)} />
									</div>
									<div>
										<label for="hours-{hall.id}">Hours</label>
										<input id="hours-{hall.id}" type="number" min="1" max="15" bind:value={f.hours} onchange={() => fetchHallQuote(hall.id)} />
									</div>
									<div>
										<label for="guestCount-{hall.id}">Guests</label>
										<input id="guestCount-{hall.id}" type="number" min="1" max={hall.capacity} bind:value={f.guestCount} />
									</div>
									{#if hall.supportedEventTypes.length > 0}
										<div>
											<label for="eventType-{hall.id}">Event type</label>
											<select id="eventType-{hall.id}" bind:value={f.eventType}>
												{#each hall.supportedEventTypes as et (et)}<option value={et}>{et}</option>{/each}
											</select>
										</div>
									{/if}
								</div>

								{#if f.loading}
									<p class="sf-hall-status">Pricing…</p>
								{:else if f.quoteError}
									<p class="sf-hall-status" style="color: var(--ledger-danger, #b91c1c)">{f.quoteError}</p>
								{:else if f.quote}
									<div class="sf-hall-quote">
										<div class="sf-quote-rows">
											<div class="sf-quote-row"><span>Base ({f.quote.baseHours}h)</span><span class="ledger-data">{peso(f.quote.basePriceCentavos)}</span></div>
											{#if f.quote.extraHours > 0}
												<div class="sf-quote-row"><span>Extra {f.quote.extraHours}h × {peso(f.quote.extraHourFeeCentavos)}</span><span class="ledger-data">{peso(f.quote.extraHoursCostCentavos)}</span></div>
											{/if}
											{#each f.quote.fees as fee (fee.name)}
												<div class="sf-quote-row"><span>{fee.name}</span><span class="ledger-data">{peso(fee.amountCentavos)}</span></div>
											{/each}
											<div class="sf-quote-row"><span>VAT</span><span class="ledger-data">{peso(f.quote.vatCentavos)}</span></div>
											<div class="sf-quote-row is-total"><span>Total</span><span class="ledger-data">{peso(f.quote.totalCentavos)}</span></div>
										</div>
										<div>
											<p class="sf-hall-status" style="margin-top: 0">
												Additional hours are charged at {peso(hall.extraHourFeeCentavos)} per hour after the first {hall.baseHours}.
												We confirm availability for your date before anything is charged.
											</p>
											{#if f.eventDate}
												<button type="button" class="sf-btn" style="margin-top: 1rem" onclick={() => bookHall(hall.id, hall.name)}>
													<CalendarCheckIcon class="size-4" aria-hidden="true" /> Reserve this date
												</button>
											{:else}
												<p class="sf-hall-status">Pick an event date to continue.</p>
											{/if}
										</div>
									</div>
								{:else}
									<p class="sf-hall-status">Pick a date and time to see the price.</p>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<!-- ============================ Gallery ============================ -->
	{#if galleryImages.length > 0}
		<section id="gallery" class="sf-section">
			<div class="sf-wrap">
				<div class="sf-head">
					<h2 class="sf-h2">A look inside {data.hotel.name}</h2>
					<button type="button" class="sf-link" onclick={() => (lightboxIndex = 0)}>
						View all {galleryImages.length} photos <ArrowRightIcon class="size-4" aria-hidden="true" />
					</button>
				</div>
				<div class="sf-gallery" data-count={galleryImages.slice(0, 9).length}>
					{#each galleryImages.slice(0, 9) as url, i (url)}
						<button type="button" onclick={() => (lightboxIndex = i)} aria-label="View photo {i + 1} larger">
							<img src={url} alt="" loading="lazy" onerror={hidePhoto} />
						</button>
					{/each}
				</div>
			</div>
		</section>
	{/if}

	<!-- ============================ Reviews ============================ -->
	{#if data.reviews.length > 0}
		<section id="reviews" class="sf-section sf-section--tint">
			<div class="sf-wrap">
				<div class="sf-head"><h2 class="sf-h2">What guests say</h2></div>
				<div class="sf-reviews">
					{#each data.reviews as r (r.guestDisplayName + r.submittedAt)}
						<figure class="sf-review">
							<div class="sf-stars" role="img" aria-label="{r.rating} out of 5 stars">
								{#each Array(5) as _, i (i)}
									<StarIcon class="size-4 {i < r.rating ? 'fill-current' : 'opacity-25'}" aria-hidden="true" />
								{/each}
							</div>
							<blockquote style="margin-top: 0.75rem">“{r.comment}”</blockquote>
							<figcaption>{r.guestDisplayName}</figcaption>
						</figure>
					{/each}
				</div>
			</div>
		</section>
	{/if}
</main>

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

<StorefrontLightbox images={galleryImages} bind:index={lightboxIndex} />

<RoomQuickView
	bind:open={qvOpen}
	room={qvRoom}
	live={qvRoom ? (liveById.get(qvRoom.id) ?? null) : null}
	{search}
	hotelSlug={slug}
	vatRateBps={data.hotel.vatRateBps}
	themeStyle={sheetTheme}
	{stayQuery}
	onReserve={reserve}
	onPickDates={pickDates}
/>
