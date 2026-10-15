<script lang="ts">
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CircleXIcon from '@lucide/svelte/icons/circle-x';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import type { AvailableRoomType, AvailableRatePlan } from '$lib/server/availability';
	import { computeDownpayment, isPartialDownpayment } from '$lib/downpayment';
	import { cancellationLabel, roomLinePrice } from '$lib/room-line';
	import { nightsLabel } from '$lib/stay-dates';

	/**
	 * The live rate options for one room type over the guest's chosen dates, cheapest first. Each row answers
	 * the questions in the order a guest asks them: what is this rate (name, what is included), what are the
	 * terms (cancellation, how much is paid now), what does it cost (total for the stay, the average per
	 * night), and a Reserve button. Totals come from `roomLinePrice`, the same arithmetic that builds the cart
	 * line, so what is shown is what lands in the cart. The layout follows the width of its container, so the
	 * same list works in the room card and in the narrow quick-view sheet.
	 */
	let {
		room,
		nights,
		vatRateBps,
		onReserve
	}: {
		room: AvailableRoomType;
		nights: number;
		vatRateBps: number;
		onReserve: (room: AvailableRoomType, plan: AvailableRatePlan) => void;
	} = $props();

	const peso = (centavos: number) =>
		`₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

	const rows = $derived(
		room.ratePlans
			.map((plan) => {
				const total = roomLinePrice(room, plan, 1, vatRateBps).totalCentavos;
				const bps = plan.cancellation?.downpaymentBps ?? null;
				const partial = isPartialDownpayment(bps);
				return {
					plan,
					total,
					perNight: Math.round(total / Math.max(1, nights)),
					cancel: cancellationLabel(plan.cancellation),
					dueNow: partial ? computeDownpayment([{ totalCentavos: total, downpaymentBps: bps }]).dueNowCentavos : null,
					pct: partial && bps != null ? Math.round(bps / 100) : null
				};
			})
			.sort((a, b) => a.total - b.total)
	);
</script>

<div class="sf-rates">
	<div class="sf-rates-head">
		<span>Choose a rate</span>
		<span>{rows.length} option{rows.length === 1 ? '' : 's'} for {nightsLabel(nights)}</span>
	</div>

	{#each rows as r, i (r.plan.id)}
		<div class="sf-rate">
			<div class="sf-rate-main">
				<h4 class="sf-rate-name">
					{r.plan.name}
					{#if i === 0 && rows.length > 1}<span class="sf-rate-best">Lowest price</span>{/if}
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
				{#if room.extraBedsNeeded > 0}
					<p class="sf-rate-fine">Includes {room.extraBedsNeeded} extra bed{room.extraBedsNeeded === 1 ? '' : 's'} for your party.</p>
				{/if}
				{#if r.plan.securityDepositCentavos}
					<p class="sf-rate-fine">Refundable security deposit {peso(r.plan.securityDepositCentavos)} per room, collected at check-in. It is not part of the price.</p>
				{/if}
			</div>

			<div class="sf-rate-price">
				<span class="sf-rate-total">{peso(r.total)}</span>
				<span class="sf-rate-per">total for {nightsLabel(nights)}</span>
				<span class="sf-rate-avg">{peso(r.perNight)} / night on average</span>
				<span class="sf-rate-avg">taxes &amp; fees included</span>
			</div>

			<button type="button" class="sf-btn sf-rate-go" onclick={() => onReserve(room, r.plan)}>Reserve</button>
		</div>
	{/each}
</div>
