<script lang="ts" module>
	import type { AvailableRoomType } from '$lib/server/availability';
	/** The same room type searched as `roomCount` rooms, for a party too big for one (whole-room rates only). */
	export type SplitOffer = { roomCount: number; party: number; room: AvailableRoomType };
</script>

<script lang="ts">
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CircleXIcon from '@lucide/svelte/icons/circle-x';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import type { AvailableRatePlan } from '$lib/server/availability';
	import { computeDownpayment, isPartialDownpayment } from '$lib/downpayment';
	import { cancellationLabel, roomLinePrice } from '$lib/room-line';
	import { splitInteger } from '$lib/room-split';
	import { nightsLabel } from '$lib/stay-dates';

	/**
	 * The live rate options for one room type over the guest's chosen dates, cheapest first. Each row answers
	 * the questions in the order a guest asks them: what is this rate (name, what is included), what are the
	 * terms (cancellation, how much is paid now), what does it cost (total for the stay, the average per
	 * night), and a Reserve button. Totals come from `roomLinePrice`, the same arithmetic that builds the cart
	 * line, so what is shown is what lands in the cart. The layout follows the width of its container, so the
	 * same list works in the room card and in the narrow quick-view sheet.
	 *
	 * A party too big for one room also gets the `split` offer (N rooms of this type). A rate that fits both
	 * ways (3 guests: 1 room + extra bed, or 2 rooms) shows a choice, the cheaper one picked first.
	 */
	let {
		room,
		split = null,
		nights,
		vatRateBps,
		onReserve
	}: {
		/** One-room result; null when the party only fits as `split`. */
		room: AvailableRoomType | null;
		split?: SplitOffer | null;
		nights: number;
		vatRateBps: number;
		onReserve: (room: AvailableRoomType, plan: AvailableRatePlan, roomCount: number) => void;
	} = $props();

	const peso = (centavos: number) =>
		`₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

	type Option = { roomCount: number; room: AvailableRoomType; plan: AvailableRatePlan; total: number };

	/** The guest's pick per rate when it fits both ways; unset = the cheaper option. */
	let picked = $state<Record<string, number>>({});

	const rows = $derived.by(() => {
		const ids = [...new Set([...(room?.ratePlans ?? []), ...(split?.room.ratePlans ?? [])].map((p) => p.id))];
		return ids.map((id) => {
			const one = room?.ratePlans.find((p) => p.id === id);
			const many = split?.room.ratePlans.find((p) => p.id === id);
			const options: Option[] = [];
			if (room && one?.fitsParty) options.push({ roomCount: 1, room, plan: one, total: roomLinePrice(one, 1, vatRateBps).totalCentavos });
			if (split && many)
				options.push({ roomCount: split.roomCount, room: split.room, plan: many, total: roomLinePrice(many, split.roomCount, vatRateBps).totalCentavos });
			const cheapest = options.reduce<Option | undefined>((a, o) => (!a || o.total < a.total ? o : a), undefined);
			const chosen = options.find((o) => o.roomCount === picked[id]) ?? cheapest;
			// A rate too small for the party has no option; it still shows, greyed, from the one-room result.
			const plan = chosen?.plan ?? (one ?? many)!;
			const total = chosen?.total ?? roomLinePrice(plan, 1, vatRateBps).totalCentavos;
			const bps = plan.cancellation?.downpaymentBps ?? null;
			const partial = isPartialDownpayment(bps);
			return {
				id,
				plan,
				options,
				chosen,
				fits: options.length > 0,
				sortTotal: cheapest?.total ?? total,
				total,
				perNight: Math.round(total / Math.max(1, nights)),
				cancel: cancellationLabel(plan.cancellation),
				dueNow: partial ? computeDownpayment([{ totalCentavos: total, downpaymentBps: bps }]).dueNowCentavos : null,
				pct: partial && bps != null ? Math.round(bps / 100) : null
			};
		});
	});
	// Smallest "Good for" that still fits the party; fitting rates for more guests than that are muted, still bookable.
	const snugGuests = $derived(Math.min(...rows.filter((r) => r.fits && r.plan.maxGuests != null).map((r) => r.plan.maxGuests!)));
	const rank = (r: { fits: boolean; plan: AvailableRatePlan }) =>
		!r.fits ? 2 : r.plan.maxGuests != null && r.plan.maxGuests > snugGuests ? 1 : 0;
	// Order: right-sized rates, then roomier ones (muted), then too-small ones (disabled); cheapest first within
	// each. Sorted by the cheapest option so a row doesn't jump when the guest switches 1 room ↔ 2 rooms.
	const sorted = $derived([...rows].sort((a, b) => rank(a) - rank(b) || a.sortTotal - b.sortTotal));
	const fitCount = $derived(rows.filter((r) => rank(r) === 0).length);

	const optionLabel = (o: Option) =>
		o.roomCount > 1 ? `${o.roomCount} rooms` : o.plan.extraBedsNeeded > 0 ? `1 room + extra bed` : '1 room';
	const perRoomText = (o: Option) => {
		const guests = splitInteger(split?.party ?? o.roomCount, o.roomCount);
		return new Set(guests).size === 1 ? `${guests[0]} guests each` : guests.join(' + ') + ' guests';
	};
</script>

<div class="sf-rates">
	<div class="sf-rates-head">
		<span>Choose a rate</span>
		<span>{sorted.length} option{sorted.length === 1 ? '' : 's'} for {nightsLabel(nights)}</span>
	</div>

	{#each sorted as r, i (r.id)}
		<div class="sf-rate" class:is-unfit={!r.fits} class:is-roomy={rank(r) === 1} aria-disabled={!r.fits}>
			<div class="sf-rate-main">
				<h4 class="sf-rate-name">
					{r.plan.name}
					{#if i === 0 && rank(r) === 0 && fitCount > 1}<span class="sf-rate-best">Lowest price</span>{/if}
				</h4>
				<ul class="sf-rate-perks">
					{#each r.plan.inclusions.slice(0, 3) as inc (inc)}
						<li><CircleCheckIcon aria-hidden="true" />{inc}</li>
					{/each}
					<li class:is-free={r.cancel.free} class:is-strict={!r.cancel.free}>
						{#if r.cancel.free}<ShieldCheckIcon aria-hidden="true" />{:else}<CircleXIcon aria-hidden="true" />{/if}{r.cancel.text}
					</li>
					{#if r.dueNow != null && r.pct != null}
						<li><WalletIcon aria-hidden="true" />{r.pct}% due now ({peso(r.dueNow)}), the balance at the hotel</li>
					{/if}
				</ul>
				{#if r.options.length > 1}
					<div class="sf-rate-opts" role="radiogroup" aria-label="How your party stays on {r.plan.name}">
						{#each r.options as o (o.roomCount)}
							<button
								type="button"
								role="radio"
								aria-checked={r.chosen === o}
								onclick={() => (picked = { ...picked, [r.id]: o.roomCount })}
							>
								{optionLabel(o)} <span class="ledger-data">{peso(o.total)}</span>
							</button>
						{/each}
					</div>
				{/if}
				{#if r.chosen && r.chosen.roomCount > 1}
					<p class="sf-rate-fine sf-rate-split">{r.chosen.roomCount} rooms for your party · {perRoomText(r.chosen)}</p>
				{/if}
				{#if !r.fits}
					<p class="sf-rate-fine sf-rate-unfit">Good for up to {r.plan.maxGuests} guest{r.plan.maxGuests === 1 ? '' : 's'} per room{#if room?.extraBedAllowed && room.maxExtraBeds > 0 && (r.plan.maxGuests ?? 0) >= room.maxOccupancy} (+{room.maxExtraBeds} extra bed{room.maxExtraBeds === 1 ? '' : 's'}){/if}, too small for your party.</p>
				{/if}
				{#if rank(r) === 1}
					<p class="sf-rate-fine">Good for {r.plan.maxGuests} guests per room, more than your party needs.</p>
				{/if}
				{#if r.chosen?.roomCount === 1 && r.plan.extraBedsNeeded > 0}
					<p class="sf-rate-fine">Includes {r.plan.extraBedsNeeded} extra bed{r.plan.extraBedsNeeded === 1 ? '' : 's'} for your party.</p>
				{/if}
				{#if r.plan.securityDepositCentavos}
					<p class="sf-rate-fine">Refundable security deposit {peso(r.plan.securityDepositCentavos)} per room, collected at check-in. It is not part of the price.</p>
				{/if}
			</div>

			<div class="sf-rate-price">
				<span class="sf-rate-total">{peso(r.total)}</span>
				<span class="sf-rate-per">total for {nightsLabel(nights)}{#if r.chosen && r.chosen.roomCount > 1}, {r.chosen.roomCount} rooms{/if}</span>
				<span class="sf-rate-avg">{peso(r.perNight)} / night on average</span>
				<span class="sf-rate-avg">taxes &amp; fees included</span>
			</div>

			<button
				type="button"
				class="sf-btn sf-rate-go"
				disabled={!r.chosen}
				onclick={() => r.chosen && onReserve(r.chosen.room, r.chosen.plan, r.chosen.roomCount)}
			>
				{r.chosen && r.chosen.roomCount > 1 ? `Reserve ${r.chosen.roomCount} rooms` : 'Reserve'}
			</button>
		</div>
	{/each}
</div>
