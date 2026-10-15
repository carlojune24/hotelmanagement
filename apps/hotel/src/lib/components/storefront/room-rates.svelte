<script lang="ts">
	import type { AvailableRoomType, AvailableRatePlan } from '$lib/server/availability';
	import { cancellationLabel, roomLinePrice } from '$lib/room-line';
	import { nightsLabel } from '$lib/stay-dates';

	/**
	 * The live rate options for one room type over the guest's chosen dates: plan name, cancellation
	 * terms, the total for the whole stay, and a Reserve button. Totals come from `roomLinePrice`, the same
	 * arithmetic that builds the cart line, so what is shown is what lands in the cart.
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
</script>

<div class="sf-rates">
	{#each room.ratePlans as plan (plan.id)}
		{@const total = roomLinePrice(room, plan, 1, vatRateBps).totalCentavos}
		{@const cancel = cancellationLabel(plan.cancellation)}
		<div class="sf-rate">
			<div>
				<span class="sf-rate-name">{plan.name}</span>
				<span class="sf-rate-note" class:is-free={cancel.free}>{cancel.text}</span>
				{#if plan.inclusions.length > 0}
					<span class="sf-rate-note">{plan.inclusions.slice(0, 3).join(' · ')}</span>
				{/if}
				{#if room.extraBedsNeeded > 0}
					<span class="sf-rate-note">Includes {room.extraBedsNeeded} extra bed{room.extraBedsNeeded === 1 ? '' : 's'} for your party</span>
				{/if}
			</div>
			<div>
				<span class="sf-rate-total">{peso(total)}</span>
				<span class="sf-rate-per">{nightsLabel(nights)}, taxes &amp; fees included</span>
			</div>
			<button type="button" class="sf-btn sf-btn--sm" onclick={() => onReserve(room, plan)}>Reserve</button>
		</div>
	{/each}
</div>
