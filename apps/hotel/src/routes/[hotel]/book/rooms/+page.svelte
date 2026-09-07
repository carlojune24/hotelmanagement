<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { amenityIcon } from '$lib/amenity-icons';
	import BedIcon from '@lucide/svelte/icons/bed';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CircleXIcon from '@lucide/svelte/icons/circle-x';
	import { getContext } from 'svelte';
	import type { CartStore } from '$lib/cart.svelte';
	import type { BedConfigEntry } from '$lib/server/db/schema/inventory';
	import type { AmenityHighlight, AvailableRatePlan, AvailableRoomType, CancellationTerms } from '$lib/server/availability';
	import { MAX_ROOMS_PER_LINE, scaleRoomPrice } from '$lib/pricing-utils';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const cart = getContext<CartStore>('cart');

	const peso = (centavos: number) =>
		`₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

	let roomCounts = $state<Record<string, number>>(
		Object.fromEntries(data.results.map((rt) => [rt.id, 1]))
	);
	const clampRoomCount = (rt: AvailableRoomType, n: number) =>
		Math.max(1, Math.min(MAX_ROOMS_PER_LINE, rt.availableRooms, n));

	function addRoomToCart(roomType: AvailableRoomType, plan: AvailableRatePlan) {
		const count = roomCounts[roomType.id] ?? 1;
		cart.addRoom({
			roomTypeId: roomType.id,
			ratePlanId: plan.id,
			roomTypeName: roomType.name,
			ratePlanName: plan.name,
			checkIn: data.checkIn,
			checkOut: data.checkOut,
			occupancy: data.adults + data.children,
			roomCount: count,
			price: scaleRoomPrice(plan.price, count)
		});
	}

	const bedConfigText = (entries: BedConfigEntry[]) =>
		entries.map((e) => `${e.quantity} ${e.type}`).join(' + ');

	function cancellationLabel(c: CancellationTerms | null): { text: string; free: boolean } {
		if (c && c.freeCancelHours != null) {
			const days = Math.floor(c.freeCancelHours / 24);
			const text =
				c.freeCancelHours % 24 === 0 && days >= 1
					? `Free cancellation up to ${days} day${days === 1 ? '' : 's'} before check-in`
					: `Free cancellation up to ${c.freeCancelHours}h before check-in`;
			return { text, free: true };
		}
		return { text: 'Non-refundable', free: false };
	}

	function hidePhoto(e: Event) {
		(e.currentTarget as HTMLImageElement).style.display = 'none';
	}
	const coverPhoto = (photos: { url: string; tag: string }[]) =>
		photos.find((p) => p.tag === 'cover')?.url ?? photos[0]?.url ?? null;

	const roomDetailHref = (rt: AvailableRoomType) =>
		`${rt.id}?checkIn=${data.checkIn}&checkOut=${data.checkOut}&adults=${data.adults}&children=${data.children}`;

	// Back to Dates, pre-filled with whatever's already known — same param set the
	// Booking Summary sidebar's own "Edit" link builds.
	const backHref = $derived(
		`dates?${new URLSearchParams({
			checkIn: data.checkIn,
			checkOut: data.checkOut,
			adults: String(data.adults),
			children: String(data.children),
			...(data.accessibleOnly ? { accessible: '1' } : {})
		}).toString()}`
	);
</script>

{#snippet glanceRow(
	bedConfiguration: BedConfigEntry[],
	wheelchairAccessible: boolean,
	highlightedAmenities: AmenityHighlight[]
)}
	{#if bedConfiguration.length > 0 || wheelchairAccessible || highlightedAmenities.length > 0}
		<div class="storefront-glance-row">
			{#if bedConfiguration.length > 0}
				<span class="storefront-glance-item">
					<BedIcon aria-hidden="true" />
					<span>{bedConfigText(bedConfiguration)}</span>
				</span>
			{/if}
			{#each highlightedAmenities.slice(0, 3) as a (a.name)}
				{@const Icon = amenityIcon(a.icon)}
				<span class="storefront-glance-item">
					<Icon aria-hidden="true" />
					<span>{a.name}</span>
				</span>
			{/each}
			{#if wheelchairAccessible}
				{@const AccIcon = amenityIcon('accessibility')}
				<span class="storefront-glance-item">
					<AccIcon aria-hidden="true" />
					<span>Accessible</span>
				</span>
			{/if}
		</div>
	{/if}
{/snippet}

<svelte:head>
	<title>Select rooms & rates — Book your stay</title>
</svelte:head>

<div>
	<a href={backHref} class="storefront-step-back">← Back to dates</a>
	<h1 class="mt-2 ledger-display text-2xl">Select rooms &amp; rates</h1>
	<p class="mt-1 text-sm text-[var(--ledger-ink-muted)]">
		<span class="ledger-data">{data.checkIn}</span> →
		<span class="ledger-data">{data.checkOut}</span>
		· <span class="ledger-data">{data.nights}</span> night{data.nights === 1 ? '' : 's'} ·
		<span class="ledger-data">{data.adults}</span> adult{data.adults === 1 ? '' : 's'}
		{#if data.children > 0}
			· <span class="ledger-data">{data.children}</span> child{data.children === 1 ? '' : 'ren'}
		{/if}
	</p>

	{#if data.results.length === 0}
		<p class="storefront-section-lede mt-8">
			Nothing is free for those dates and party size right now. Try different dates, or fewer
			guests per room.
		</p>
	{:else}
		<div class="mt-8 border-t border-[var(--ledger-rule)]">
			{#each data.results as roomType (roomType.id)}
				{@const cover = coverPhoto(roomType.photos)}
				{@const count = roomCounts[roomType.id] ?? 1}
				<details class="ledger-room-row group" open={roomType.id === data.highlightRoomTypeId}>
					<summary class="flex w-full cursor-pointer flex-col sm:flex-row">
						<div class="ledger-room-photo">
							<span class="ledger-room-photo-mark">{roomType.name.charAt(0)}</span>
							{#if cover}<img src={cover} alt="" onerror={hidePhoto} />{/if}
						</div>
						<div class="ledger-room-body">
							<div>
								<div class="ledger-display text-xl">{roomType.name}</div>
								{#if roomType.description}
									<p class="mt-0.5 max-w-md text-sm text-[var(--ledger-ink-muted)]">
										{roomType.description}
									</p>
								{/if}
								<p class="mt-1 text-xs text-[var(--ledger-ink-muted)]">
									Sleeps up to <span class="ledger-data">{roomType.maxOccupancy}</span> ·
									<span class="ledger-data">{roomType.availableRooms}</span> left
								</p>
								{@render glanceRow(
									roomType.bedConfiguration,
									roomType.wheelchairAccessible,
									roomType.highlightedAmenities
								)}
								<a href={roomDetailHref(roomType)} class="storefront-view-details-btn">
									View full details →
								</a>
							</div>
							<div class="ledger-data text-right text-xl">
								from {peso(Math.min(...roomType.ratePlans.map((p) => p.price.totalCentavos)) * count)}
							</div>
						</div>
					</summary>

					<div class="ledger-hairline bg-[var(--ledger-paper-2)] px-4 py-3 sm:pl-8">
						<div class="storefront-stepper-row max-w-xs">
							<span class="text-sm text-[var(--ledger-ink)]">Rooms</span>
							<div class="storefront-stepper">
								<button
									type="button"
									aria-label="Fewer rooms"
									onclick={() =>
										(roomCounts[roomType.id] = clampRoomCount(roomType, count - 1))}
									><MinusIcon /></button
								>
								<span class="ledger-data">{count}</span>
								<button
									type="button"
									aria-label="More rooms"
									onclick={() =>
										(roomCounts[roomType.id] = clampRoomCount(roomType, count + 1))}
									><PlusIcon /></button
								>
							</div>
						</div>
					</div>
					<div class="ledger-hairline bg-[var(--ledger-paper-2)]">
						{#each roomType.ratePlans as plan (plan.id)}
							{@const cancel = cancellationLabel(plan.cancellation)}
							<div
								class="ledger-hairline flex flex-wrap items-center justify-between gap-3 px-4 py-3 last:border-b-0 sm:pl-8"
							>
								<div>
									<div class="text-sm font-semibold text-[var(--ledger-ink)]">
										{plan.name}
									</div>
									{#if plan.inclusions.length > 0}
										<p class="mt-0.5 text-xs text-[var(--ledger-ink-muted)]">
											{plan.inclusions.join(' · ')}
										</p>
									{/if}
									<span class="storefront-cancel-badge" class:is-free={cancel.free}>
										{#if cancel.free}<CircleCheckIcon aria-hidden="true" />{:else}<CircleXIcon
												aria-hidden="true"
											/>{/if}
										{cancel.text}
									</span>
								</div>
								<div class="flex items-center gap-4">
									<div class="ledger-data text-right">
										{peso(plan.price.totalCentavos * count)}
										<span class="ledger-label block"
											>total{count > 1 ? ` · ${count} rooms` : ''}</span
										>
									</div>
									<Button
										type="button"
										onclick={() => addRoomToCart(roomType, plan)}
										class="ledger-btn-primary text-sm !px-4 !py-2"
									>
										Add to invoice
									</Button>
								</div>
							</div>
						{/each}
					</div>
				</details>
			{/each}
		</div>
	{/if}
</div>
