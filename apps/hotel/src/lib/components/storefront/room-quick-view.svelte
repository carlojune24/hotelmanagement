<script lang="ts">
	import { guestBase } from '$lib/guest-base';
	import { page } from '$app/state';
	import { getContext } from 'svelte';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import type { StorefrontTheme } from '$lib/storefront-mode.svelte';
	import BedIcon from '@lucide/svelte/icons/bed';
	import UsersIcon from '@lucide/svelte/icons/users';
	import RulerIcon from '@lucide/svelte/icons/ruler';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import AccessibilityIcon from '@lucide/svelte/icons/accessibility';
	import XIcon from '@lucide/svelte/icons/x';
	import { humanize } from '$lib/room-line';
	import RoomRates from '$lib/components/storefront/room-rates.svelte';
	import { amenityIcon } from '$lib/amenity-icons';
	import { AMENITY_CATEGORY_LABELS, AMENITY_CATEGORY_ORDER } from '$lib/amenity-categories';
	import type { AvailableRatePlan, AvailableRoomType, BrowsableRoomType } from '$lib/server/availability';
	import type { BedConfigEntry } from '$lib/server/db/schema/inventory';
	const base = $derived(guestBase(page));

	/**
	 * Quick view: a room's photos, facts, full amenity list and rate options in a sheet, without leaving
	 * the page. The sheet renders through a portal outside the `.woven-ledger` wrapper, so it re-declares
	 * the hotel's theme tokens on itself (same approach as the mobile nav).
	 */
	let {
		open = $bindable(false),
		room,
		live = null,
		search = null,
		hotelSlug,
		vatRateBps,
		themeStyle,
		stayQuery = '',
		onReserve,
		onPickDates
	}: {
		open?: boolean;
		room: BrowsableRoomType | null;
		live?: AvailableRoomType | null;
		search?: { checkIn: string; checkOut: string; nights: number } | null;
		hotelSlug: string;
		vatRateBps: number;
		themeStyle: string;
		stayQuery?: string;
		onReserve: (room: AvailableRoomType, plan: AvailableRatePlan) => void;
		onPickDates: () => void;
	} = $props();

	const sfTheme = getContext<StorefrontTheme | undefined>('sf-theme');

	const peso = (centavos: number) =>
		`₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
	const bedText = (entries: BedConfigEntry[]) => entries.map((e) => `${e.quantity} ${e.type}`).join(' + ');

	let photoIndex = $state(0);
	$effect(() => {
		// A different room always opens on its first photo.
		void room?.id;
		photoIndex = 0;
	});
	const photos = $derived(room?.photos ?? []);
	const current = $derived(photos[photoIndex]?.url ?? null);

	const groups = $derived.by(() => {
		const byCat = new Map<string, NonNullable<typeof room>['amenities']>();
		for (const a of room?.amenities ?? []) {
			const list = byCat.get(a.category) ?? [];
			list.push(a);
			byCat.set(a.category, list);
		}
		return AMENITY_CATEGORY_ORDER.filter((c) => byCat.has(c)).map((c) => ({
			label: AMENITY_CATEGORY_LABELS[c],
			items: byCat.get(c)!
		}));
	});

	const searched = $derived(search !== null);
	const detailHref = $derived(room ? `${base}/rooms/${room.id}${stayQuery}` : '#');

	function hidePhoto(e: Event) {
		(e.currentTarget as HTMLImageElement).style.display = 'none';
	}
</script>

<Sheet.Root bind:open>
	<Sheet.Content
		side="right"
		style={themeStyle}
		data-mode={sfTheme?.mode ?? 'light'}
		showCloseButton={false}
		class="woven-ledger w-full gap-0 overflow-hidden border-l-[var(--ledger-rule)] bg-[var(--ledger-paper)] p-0 text-[var(--ledger-ink)] sm:max-w-lg"
	>
		{#if room}
			<div class="sf-qv">
				<Sheet.Title class="sr-only">{room.name}</Sheet.Title>
				<Sheet.Description class="sr-only">Photos, facts and rates for {room.name}</Sheet.Description>

				<div class="sf-qv-gallery">
					<Sheet.Close class="sf-qv-close" aria-label="Close quick view"><XIcon class="size-5" aria-hidden="true" /></Sheet.Close>
					{#if current}<img src={current} alt="{room.name}, photo {photoIndex + 1}" onerror={hidePhoto} />{/if}
				</div>
				{#if photos.length > 1}
					<div class="sf-qv-thumbs" role="group" aria-label="Photos">
						{#each photos as p, i (p.url)}
							<button type="button" aria-label="Show photo {i + 1}" aria-current={i === photoIndex} onclick={() => (photoIndex = i)}>
								<img src={p.url} alt="" loading="lazy" onerror={hidePhoto} />
							</button>
						{/each}
					</div>
				{/if}

				<div class="sf-qv-body">
					<h2>{room.name}</h2>
					<div class="sf-room-specs">
						{#if room.bedConfiguration.length > 0}
							<span><BedIcon aria-hidden="true" />{bedText(room.bedConfiguration)}{room.bedFlexible ? ' (flexible)' : ''}</span>
						{/if}
						<span><UsersIcon aria-hidden="true" />Sleeps {room.baseOccupancy}–{room.maxOccupancy}</span>
						{#if room.sizeSqm}<span><RulerIcon aria-hidden="true" />{room.sizeSqm} m²</span>{/if}
						{#if room.viewType}<span><EyeIcon aria-hidden="true" />{humanize(room.viewType)}</span>{/if}
						{#if room.wheelchairAccessible}<span><AccessibilityIcon aria-hidden="true" />Wheelchair accessible</span>{/if}
					</div>
					{#if room.description}
						<p class="mt-4 leading-relaxed text-[var(--ledger-ink-muted)]">{room.description}</p>
					{/if}

					{#if live && search}
						<h3>Your stay</h3>
						<RoomRates room={live} nights={search.nights} {vatRateBps} {onReserve} />
					{:else if searched}
						<p class="sf-room-unavailable">Not available for your dates. Try other dates.</p>
					{/if}

					{#if groups.length > 0}
						<h3>What's included</h3>
						{#each groups as g (g.label)}
							<p class="mt-3 text-xs font-semibold tracking-wide text-[var(--ledger-ink-muted)] uppercase">{g.label}</p>
							<ul class="sf-plain-list">
								{#each g.items as a (a.name)}
									{@const Icon = amenityIcon(a.icon)}
									<li class="flex items-center gap-2"><Icon class="size-4 shrink-0 text-[var(--hotel-accent)]" aria-hidden="true" />{a.name}</li>
								{/each}
							</ul>
						{/each}
					{/if}
				</div>

				<div class="sf-qv-foot">
					{#if live}
						<a href={detailHref} class="sf-link">Full details</a>
					{:else if searched}
						<button type="button" class="sf-btn sf-btn--outline sf-btn--sm" onclick={onPickDates}>Change dates</button>
					{:else}
						<span class="text-sm text-[var(--ledger-ink-muted)]">
							{#if room.startingPriceCentavos != null}from <b class="ledger-data text-base text-[var(--ledger-ink)]">{peso(room.startingPriceCentavos)}</b> / night{/if}
						</span>
						<button type="button" class="sf-btn sf-btn--sm" onclick={onPickDates}>Check dates &amp; price</button>
					{/if}
				</div>
			</div>
		{/if}
	</Sheet.Content>
</Sheet.Root>
