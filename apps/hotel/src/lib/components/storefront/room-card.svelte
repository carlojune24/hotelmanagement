<script lang="ts">
	import BedIcon from '@lucide/svelte/icons/bed';
	import UsersIcon from '@lucide/svelte/icons/users';
	import RulerIcon from '@lucide/svelte/icons/ruler';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import RoomRates from '$lib/components/storefront/room-rates.svelte';
	import { FEW_LEFT_ROOMS } from '$lib/day-availability';
	import type { AvailableRatePlan, AvailableRoomType, BrowsableRoomType } from '$lib/server/availability';
	import type { BedConfigEntry } from '$lib/server/db/schema/inventory';

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
		onQuickView,
		onReserve,
		onPickDates,
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
		onQuickView: (room: BrowsableRoomType) => void;
		onReserve: (room: AvailableRoomType, plan: AvailableRatePlan) => void;
		onPickDates: () => void;
		/** Query string carried onto the detail page so it stays dated. */
		stayQuery?: string;
	} = $props();

	const peso = (centavos: number) =>
		`₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
	const bedText = (entries: BedConfigEntry[]) => entries.map((e) => `${e.quantity} ${e.type}`).join(' + ');
	const cover = $derived(room.photos.find((p) => p.tag === 'cover')?.url ?? room.photos[0]?.url ?? null);
	const detailHref = $derived(`/${hotelSlug}/rooms/${room.id}${stayQuery}`);
	const searched = $derived(search !== null);
	const unavailable = $derived(searched && live === null);

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
	<article class="sf-room sf-room--stay" class:is-unavailable={unavailable}>
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
				</div>
			</div>
		</div>

		{#if live}
			<RoomRates room={live} nights={search!.nights} {vatRateBps} {onReserve} />
		{:else}
			<div class="sf-stay-none">
				<p>This room isn't available for your dates or party size. Try other dates, or have a look at the other rooms.</p>
				<button type="button" class="sf-btn sf-btn--outline sf-btn--sm" onclick={onPickDates}>Change dates</button>
			</div>
		{/if}
	</article>
{:else}
	<article class="sf-room">
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
				<button type="button" class="sf-btn" onclick={onPickDates}>Check dates &amp; price</button>
				<button type="button" class="sf-link" onclick={() => onQuickView(room)}>Quick view</button>
				<a href={detailHref} class="sf-link">Details <ArrowRightIcon class="size-4" aria-hidden="true" /></a>
			</div>
		</div>
	</article>
{/if}
