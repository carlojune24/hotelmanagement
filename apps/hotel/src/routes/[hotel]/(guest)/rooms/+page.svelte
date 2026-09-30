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
	import { FEW_LEFT_ROOMS } from '$lib/day-availability';
	import { formatStayDateShort, nightsLabel } from '$lib/stay-dates';
	import type { BedConfigEntry } from '$lib/server/db/schema/inventory';
	import type { AmenityHighlight, AvailableRatePlan, AvailableRoomType, CancellationTerms } from '$lib/server/availability';
	import { MAX_ROOMS_PER_LINE, addFlatFeeCentavos, scaleRoomPrice } from '$lib/pricing-utils';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const cart = getContext<CartStore>('cart');

	const peso = (centavos: number) =>
		`₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

	/** Keyed per rate plan, not per room type — each rate plan books its own count of
	 *  physical rooms, so a guest can split several rooms of the same type across
	 *  different rates (e.g. one with parking, one without) instead of one shared
	 *  stepper implying "this many rooms total" while every rate button adds its own. */
	let roomCounts = $state<Record<string, number>>(
		Object.fromEntries(data.results.flatMap((rt) => rt.ratePlans.map((p) => [p.id, 1])))
	);
	const clampRoomCount = (rt: AvailableRoomType, n: number) =>
		Math.max(1, Math.min(MAX_ROOMS_PER_LINE, rt.availableRooms, n));

	function addRoomToCart(roomType: AvailableRoomType, plan: AvailableRatePlan) {
		const count = roomCounts[plan.id] ?? 1;
		let price = scaleRoomPrice(plan.price, count);
		// Mirrors the real charge `details`'s `createOrder` re-derives server-side —
		// shown here too so the cart/review total isn't a surprise jump at checkout.
		if (roomType.extraBedsNeeded > 0 && plan.extraBedFeeCentavos) {
			price = addFlatFeeCentavos(
				price,
				`Extra bed × ${roomType.extraBedsNeeded}`,
				roomType.extraBedsNeeded * plan.extraBedFeeCentavos,
				data.hotel.vatRateBps
			);
		}
		cart.addRoom({
			roomTypeId: roomType.id,
			ratePlanId: plan.id,
			roomTypeName: roomType.name,
			ratePlanName: plan.name,
			checkIn: data.checkIn,
			checkOut: data.checkOut,
			occupancy: data.adults + data.children,
			roomCount: count,
			price,
			downpaymentBps: plan.cancellation?.downpaymentBps ?? null
		});
	}

	const bedConfigText = (entries: BedConfigEntry[]) =>
		entries.map((e) => `${e.quantity} ${e.type}`).join(' + ');

	/** Same scale-then-extra-bed math `addRoomToCart` uses — kept in sync so the displayed
	 *  row total always matches what actually lands in the cart. */
	function lineTotalCentavos(roomType: AvailableRoomType, plan: AvailableRatePlan, count: number): number {
		let price = scaleRoomPrice(plan.price, count);
		if (roomType.extraBedsNeeded > 0 && plan.extraBedFeeCentavos) {
			price = addFlatFeeCentavos(
				price,
				`Extra bed × ${roomType.extraBedsNeeded}`,
				roomType.extraBedsNeeded * plan.extraBedFeeCentavos,
				data.hotel.vatRateBps
			);
		}
		return price.totalCentavos;
	}

	/** "₱4,200.00 × 3 nights" when every night costs the same, otherwise the average — so the
	 *  guest can see how a room's price is built. Null for a single-night stay. */
	function nightlyNote(plan: AvailableRatePlan): string | null {
		const nights = plan.price.nights;
		if (nights.length < 2) return null;
		const first = nights[0]!.priceCentavos;
		const even = nights.every((n) => n.priceCentavos === first);
		const avg = Math.round(plan.price.subtotalCentavos / nights.length);
		return even
			? `${peso(first)} × ${nightsLabel(nights.length)}`
			: `avg ${peso(avg)} × ${nightsLabel(nights.length)}`;
	}

	/** How many rooms of this rate are already on the invoice for these dates. */
	const addedCount = (planId: string) =>
		cart.items.reduce(
			(sum, i) =>
				i.kind === 'room' &&
				i.ratePlanId === planId &&
				i.checkIn === data.checkIn &&
				i.checkOut === data.checkOut
					? sum + i.roomCount
					: sum,
			0
		);

	const lowStock = (rt: AvailableRoomType) => rt.availableRooms <= FEW_LEFT_ROOMS;

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

	<!-- Your stay: the dates and party in words, with a one-tap way to change them. -->
	<div
		class="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-md border border-[var(--ledger-rule)] bg-[var(--ledger-paper-2)] px-4 py-3"
	>
		<div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
			<span class="ledger-data text-[0.9375rem]">{formatStayDateShort(data.checkIn)}</span>
			<span class="text-[var(--ledger-ink-muted)]" aria-hidden="true">→</span>
			<span class="ledger-data text-[0.9375rem]">{formatStayDateShort(data.checkOut)}</span>
			<span class="text-sm text-[var(--ledger-ink-muted)]">
				· {nightsLabel(data.nights)} · {data.adults} adult{data.adults === 1 ? '' : 's'}{#if data.children > 0}, {data.children}
					child{data.children === 1 ? '' : 'ren'}{/if}
			</span>
		</div>
		<a
			href={backHref}
			class="text-sm font-medium text-[var(--hotel-accent-deep)] underline underline-offset-2"
		>
			Change dates
		</a>
	</div>

	{#if data.results.length === 0}
		<div class="mt-8 rounded-md border border-[var(--ledger-rule)] px-5 py-6">
			<p class="ledger-display text-lg">Nothing is free for those dates</p>
			<p class="mt-1 text-sm text-[var(--ledger-ink-muted)]">
				Every room that fits your party is booked. Try different dates, or fewer guests per room.
			</p>
			<a href={backHref} class="ledger-btn-primary mt-4 inline-block text-sm">Choose other dates</a>
		</div>
	{:else}
		<p class="mt-6 text-sm text-[var(--ledger-ink-muted)]">
			{data.results.length} room type{data.results.length === 1 ? '' : 's'} available · prices are for
			your whole stay, taxes and fees included.
		</p>

		<div class="mt-4 space-y-8">
			{#each data.results as roomType (roomType.id)}
				{@const cover = coverPhoto(roomType.photos)}
				{@const highlighted = roomType.id === data.highlightRoomTypeId}
				<article
					class="overflow-hidden rounded-md border"
					style="border-color: {highlighted ? 'var(--hotel-accent)' : 'var(--ledger-rule)'};"
				>
					<div class="flex flex-col sm:flex-row">
						<div class="ledger-room-photo sm:w-64 sm:shrink-0">
							<span class="ledger-room-photo-mark">{roomType.name.charAt(0)}</span>
							{#if cover}<img src={cover} alt="" onerror={hidePhoto} />{/if}
						</div>
						<div class="flex-1 px-4 py-4 sm:px-5">
							<div class="flex flex-wrap items-start justify-between gap-2">
								<h2 class="ledger-display text-xl">{roomType.name}</h2>
								<span
									class="rounded-full border px-2.5 py-0.5 text-xs font-semibold"
									style={lowStock(roomType)
										? 'color: var(--hotel-accent-deep); border-color: var(--hotel-accent);'
										: 'color: var(--ledger-ink-muted); border-color: var(--ledger-rule);'}
								>
									{lowStock(roomType)
										? `Only ${roomType.availableRooms} left`
										: `${roomType.availableRooms} rooms available`}
								</span>
							</div>
							{#if roomType.description}
								<p class="mt-1 max-w-xl text-sm text-[var(--ledger-ink-muted)]">
									{roomType.description}
								</p>
							{/if}
							<p class="mt-2 text-xs text-[var(--ledger-ink-muted)]">
								Sleeps up to <span class="ledger-data">{roomType.maxOccupancy}</span>
								{#if roomType.sizeSqm}· <span class="ledger-data">{roomType.sizeSqm}</span> m²{/if}
							</p>
							{@render glanceRow(
								roomType.bedConfiguration,
								roomType.wheelchairAccessible,
								roomType.highlightedAmenities
							)}
							<a href={roomDetailHref(roomType)} class="storefront-view-details-btn">
								View photos &amp; full details →
							</a>
						</div>
					</div>

					<div class="border-t border-[var(--ledger-rule)] bg-[var(--ledger-paper-2)]">
						<div class="ledger-label px-4 py-2 sm:px-5">Choose a rate</div>
						{#each roomType.ratePlans as plan (plan.id)}
							{@const cancel = cancellationLabel(plan.cancellation)}
							{@const count = roomCounts[plan.id] ?? 1}
							{@const inCart = addedCount(plan.id)}
							{@const note = nightlyNote(plan)}
							<div
								class="grid gap-4 border-t border-[var(--ledger-rule)] px-4 py-4 sm:grid-cols-[1fr_auto] sm:px-5"
							>
								<div class="min-w-0">
									<div class="text-[0.9375rem] font-semibold text-[var(--ledger-ink)]">
										{plan.name}
									</div>
									{#if plan.inclusions.length > 0}
										<ul
											class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--ledger-ink-muted)]"
										>
											{#each plan.inclusions as inc (inc)}
												<li class="flex items-center gap-1">
													<CircleCheckIcon class="size-3.5" aria-hidden="true" />{inc}
												</li>
											{/each}
										</ul>
									{/if}
									<span class="storefront-cancel-badge mt-2" class:is-free={cancel.free}>
										{#if cancel.free}<CircleCheckIcon aria-hidden="true" />{:else}<CircleXIcon
												aria-hidden="true"
											/>{/if}
										{cancel.text}
									</span>
									{#if plan.cancellation?.downpaymentBps}
										<p class="ledger-data mt-1 text-xs text-[var(--ledger-ink-muted)]">
											{plan.cancellation.downpaymentBps / 100}% due at booking · balance at the hotel
										</p>
									{/if}
									{#if roomType.extraBedsNeeded > 0}
										<p class="mt-1 text-xs text-[var(--ledger-ink-muted)]">
											Includes {roomType.extraBedsNeeded} extra bed{roomType.extraBedsNeeded === 1
												? ''
												: 's'} for your party size{#if plan.extraBedFeeCentavos}
												({peso(roomType.extraBedsNeeded * plan.extraBedFeeCentavos)}){/if}
										</p>
									{/if}
								</div>

								<div class="flex flex-col gap-3 sm:w-64 sm:items-end">
									<div class="sm:text-right">
										<div class="ledger-data text-xl font-semibold">
											{peso(lineTotalCentavos(roomType, plan, count))}
										</div>
										<div class="text-xs text-[var(--ledger-ink-muted)]">
											total for {nightsLabel(data.nights)}{count > 1 ? ` · ${count} rooms` : ''}
										</div>
										{#if note}
											<div class="ledger-data mt-0.5 text-xs text-[var(--ledger-ink-muted)]">
												{note}{count > 1 ? ` × ${count} rooms` : ''}
											</div>
										{/if}
									</div>
									<div class="flex items-center justify-between gap-3 sm:justify-end">
										<div class="storefront-stepper" role="group" aria-label="Number of rooms">
											<button
												type="button"
												aria-label="Fewer rooms"
												disabled={count <= 1}
												onclick={() => (roomCounts[plan.id] = clampRoomCount(roomType, count - 1))}
												><MinusIcon /></button
											>
											<span class="ledger-data">{count}</span>
											<button
												type="button"
												aria-label="More rooms"
												disabled={count >= Math.min(MAX_ROOMS_PER_LINE, roomType.availableRooms)}
												onclick={() => (roomCounts[plan.id] = clampRoomCount(roomType, count + 1))}
												><PlusIcon /></button
											>
										</div>
										<Button
											type="button"
											onclick={() => addRoomToCart(roomType, plan)}
											class="ledger-btn-primary min-h-11 text-sm !px-5"
										>
											{inCart > 0 ? 'Add another' : 'Add to invoice'}
										</Button>
									</div>
									{#if inCart > 0}
										<p
											class="flex items-center gap-1 text-xs font-medium text-[var(--hotel-accent-deep)]"
											role="status"
										>
											<CircleCheckIcon class="size-4" aria-hidden="true" />
											{inCart} room{inCart === 1 ? '' : 's'} added to your invoice
										</p>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</article>
			{/each}
		</div>
	{/if}
</div>
