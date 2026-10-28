<script lang="ts">
	import { guestBase } from '$lib/guest-base';
	import { page } from '$app/state';
	import BedIcon from '@lucide/svelte/icons/bed';
	import UsersIcon from '@lucide/svelte/icons/users';
	import RulerIcon from '@lucide/svelte/icons/ruler';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import RoomRates from '$lib/components/storefront/room-rates.svelte';
	import AvailabilityRangePicker from '$lib/components/storefront/availability-range-picker.svelte';
	import { FEW_LEFT_ROOMS, type DayAvailability } from '$lib/day-availability';
	import type { AvailableRatePlan, AvailableRoomType, BrowsableRoomType } from '$lib/server/availability';
	import type { BedConfigEntry } from '$lib/server/db/schema/inventory';
	const base = $derived(guestBase(page));

	/**
	 * One room type. Undated: a large photo-led row with "from ₱X / night", Quick view and Details (rows
	 * alternate image side on wide screens, stack on phones). Dated (the guest searched): ONE card that reads
	 * top to bottom: the room (photo, name, availability, what it is), then "Choose a rate" with every rate's
	 * terms, total and Reserve button, or an honest "not available for these dates".
	 */
	let {
		room,
		hotelSlug,
		vatRateBps,
		search = null,
		live = null,
		stockTonight = null,
		days,
		today,
		checkIn = $bindable(''),
		checkOut = $bindable(''),
		adults = $bindable(2),
		children = $bindable(0),
		onSearch,
		onQuickView,
		onReserve,
		stayQuery = ''
	}: {
		room: BrowsableRoomType;
		hotelSlug: string;
		vatRateBps: number;
		/** The searched stay, when the guest has picked dates. */
		search?: { checkIn: string; checkOut: string; nights: number } | null;
		/** This room type's live result for the search; null when it is not available (or not searched). */
		live?: AvailableRoomType | null;
		/** Tonight's free count (undated). */
		stockTonight?: { freeTonight: number; totalRooms: number } | null;
		/** Per-night availability of THIS room type, for the card's own calendar. */
		days: DayAvailability[];
		today: string;
		/** The stay being picked; shared with the booking bar, so choosing here fills it in too. */
		checkIn?: string;
		checkOut?: string;
		adults?: number;
		children?: number;
		/** Search this stay and bring the guest back to this room, now with its live rates. */
		onSearch: () => void;
		onQuickView: (room: BrowsableRoomType) => void;
		onReserve: (room: AvailableRoomType, plan: AvailableRatePlan) => void;
		/** Query string carried onto the detail page so it stays dated. */
		stayQuery?: string;
	} = $props();

	const peso = (centavos: number) =>
		`₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
	const bedText = (entries: BedConfigEntry[]) => entries.map((e) => `${e.quantity} ${e.type}`).join(' + ');
	const cover = $derived(room.photos.find((p) => p.tag === 'cover')?.url ?? room.photos[0]?.url ?? null);
	const detailHref = $derived(`${base}/rooms/${room.id}${stayQuery}`);
	const searched = $derived(search !== null);
	const unavailable = $derived(searched && live === null);

	// The card's own date picker: opened by "Check dates & price" / "Change dates", right inside this room.
	let picking = $state(false);
	let submitting = $state(false);
	const ready = $derived(Boolean(checkIn && checkOut));
	const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
	const guests = $derived(adults + children);
	const overCapacity = $derived(guests > room.maxOccupancy);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!ready || submitting) return;
		submitting = true;
		try {
			await onSearch();
			picking = false;
		} finally {
			submitting = false;
		}
	}

	const pill = $derived.by((): { text: string; tone: '' | 'is-low' | 'is-out' } | null => {
		if (searched) {
			if (!live) return { text: 'Not available for your dates', tone: 'is-out' };
			if (live.availableRooms <= FEW_LEFT_ROOMS)
				return { text: `Only ${live.availableRooms} left for your dates`, tone: 'is-low' };
			return null;
		}
		if (!stockTonight || stockTonight.totalRooms === 0) return null;
		if (stockTonight.freeTonight === 0) return { text: 'Fully booked tonight', tone: 'is-out' };
		if (stockTonight.freeTonight <= FEW_LEFT_ROOMS)
			return { text: `Only ${stockTonight.freeTonight} left tonight`, tone: 'is-low' };
		return null;
	});

	function hidePhoto(e: Event) {
		(e.currentTarget as HTMLImageElement).style.display = 'none';
	}
</script>

{#snippet picker()}
	<form class="sf-roompick" onsubmit={submit} aria-label="Check {room.name} for your dates">
		<p class="sf-roompick-title">Check {room.name} for your dates</p>
		<div class="sf-roompick-dates">
			<AvailabilityRangePicker {days} {today} bind:checkIn bind:checkOut />
		</div>
		<div class="sf-roompick-guests">
			<div class="storefront-stepper-row">
				<span class="text-sm">Adults</span>
				<div class="storefront-stepper">
					<button type="button" aria-label="Fewer adults" disabled={adults <= 1} onclick={() => (adults = clamp(adults - 1, 1, 10))}><MinusIcon /></button>
					<span class="ledger-data">{adults}</span>
					<button type="button" aria-label="More adults" disabled={adults >= 10} onclick={() => (adults = clamp(adults + 1, 1, 10))}><PlusIcon /></button>
				</div>
			</div>
			<div class="storefront-stepper-row">
				<span class="text-sm">Children</span>
				<div class="storefront-stepper">
					<button type="button" aria-label="Fewer children" disabled={children <= 0} onclick={() => (children = clamp(children - 1, 0, 10))}><MinusIcon /></button>
					<span class="ledger-data">{children}</span>
					<button type="button" aria-label="More children" disabled={children >= 10} onclick={() => (children = clamp(children + 1, 0, 10))}><PlusIcon /></button>
				</div>
			</div>
		</div>
		<p class="sf-roompick-note" class:is-warn={overCapacity}>
			{#if overCapacity}
				This room sleeps up to {room.maxOccupancy}. We will show what fits your party of {guests}.
			{:else}
				Crossed-out nights are sold out for this room.
			{/if}
		</p>
		<div class="sf-roompick-actions">
			<button type="submit" class="sf-btn" disabled={!ready || submitting}>
				{submitting ? 'Checking…' : ready ? 'Show prices' : 'Pick your dates'}
			</button>
			<button type="button" class="sf-link" onclick={() => (picking = false)}>Cancel</button>
		</div>
	</form>
{/snippet}

{#snippet specs()}
	<div class="sf-room-specs">
		{#if room.bedConfiguration.length > 0}
			<span><BedIcon aria-hidden="true" />{bedText(room.bedConfiguration)}</span>
		{/if}
		<span><UsersIcon aria-hidden="true" />Sleeps {room.maxOccupancy}</span>
		{#if room.sizeSqm}<span><RulerIcon aria-hidden="true" />{room.sizeSqm} m²</span>{/if}
	</div>
{/snippet}

{#if searched}
	<!-- Dated: one card, top to bottom. -->
	<article id="room-{room.id}" class="sf-room sf-room--stay" class:is-unavailable={unavailable}>
		<div class="sf-stay-head">
			<a href={detailHref} class="sf-room-media" aria-label="{room.name}: full details">
				{#if cover}<img src={cover} alt="" loading="lazy" onerror={hidePhoto} />{/if}
			</a>
			<div class="sf-stay-info">
				<div class="sf-stay-title">
					<h3>{room.name}</h3>
					{#if pill}
						<span class="sf-badge {pill.tone}">{pill.text}</span>
					{:else if live}
						<span class="sf-badge is-ok">Available for your dates</span>
					{/if}
				</div>
				{@render specs()}
				{#if room.description}<p class="sf-room-desc">{room.description}</p>{/if}
				{#if room.highlightedAmenities.length > 0}
					<p class="sf-room-amen">{room.highlightedAmenities.slice(0, 4).map((a) => a.name).join(' · ')}</p>
				{/if}
				<div class="sf-room-actions">
					<button type="button" class="sf-link" onclick={() => onQuickView(room)}>Quick view</button>
					<a href={detailHref} class="sf-link">Photos &amp; full details <ArrowRightIcon class="size-4" aria-hidden="true" /></a>
					<button type="button" class="sf-link" onclick={() => (picking = !picking)} aria-expanded={picking}>Change dates</button>
				</div>
			</div>
		</div>

		{#if picking}{@render picker()}{/if}

		{#if live}
			<RoomRates room={live} nights={search!.nights} {vatRateBps} {onReserve} />
		{:else}
			<div class="sf-stay-none">
				<p>This room isn't available for your dates or party size. Try other dates, or have a look at the other rooms.</p>
				<button type="button" class="sf-btn sf-btn--outline sf-btn--sm" onclick={() => (picking = true)}>Change dates</button>
			</div>
		{/if}
	</article>
{:else}
	<article id="room-{room.id}" class="sf-room">
		<a href={detailHref} class="sf-room-media" aria-label="{room.name}: full details">
			{#if cover}<img src={cover} alt="" loading="lazy" onerror={hidePhoto} />{/if}
			{#if pill}<span class="sf-room-pill {pill.tone}">{pill.text}</span>{/if}
		</a>

		<div>
			<h3>{room.name}</h3>
			{@render specs()}
			{#if room.description}<p class="sf-room-desc">{room.description}</p>{/if}
			{#if room.highlightedAmenities.length > 0}
				<p class="sf-room-amen">{room.highlightedAmenities.slice(0, 4).map((a) => a.name).join(' · ')}</p>
			{/if}

			<div class="sf-room-price">
				{#if room.startingPriceCentavos != null}
					<span>from</span> <b>{peso(room.startingPriceCentavos)}</b> <span>/ night</span>
					{#if room.ratePlanCount > 1}<span>· {room.ratePlanCount} rate options</span>{/if}
				{:else}
					<span>Rates coming soon</span>
				{/if}
			</div>
			<div class="sf-room-actions">
				<button type="button" class="sf-btn" onclick={() => (picking = !picking)} aria-expanded={picking}>Check dates &amp; price</button>
				<button type="button" class="sf-link" onclick={() => onQuickView(room)}>Quick view</button>
				<a href={detailHref} class="sf-link">Details <ArrowRightIcon class="size-4" aria-hidden="true" /></a>
			</div>
		</div>
		{#if picking}{@render picker()}{/if}
	</article>
{/if}
