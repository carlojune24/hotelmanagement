<script lang="ts">
	import { getContext } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import type { StorefrontTheme } from '$lib/storefront-mode.svelte';
	import type { AvailableRatePlan, AvailableRoomType } from '$lib/server/availability';
	import { roomLinePrice } from '$lib/room-line';
	import { splitInteger } from '$lib/room-split';
	import { formatStayDateShort, nightsLabel } from '$lib/stay-dates';

	/**
	 * "Your party of 4 needs 2 rooms": the check before a several-room Reserve goes into the cart. Lists each
	 * room's guests with the same even split the server writes (`splitRoomLine`), plus the rate, dates and the
	 * total for all rooms. Renders through a portal, so it re-declares the hotel's theme tokens on itself
	 * (same as the quick-view sheet).
	 */
	let {
		pending,
		party,
		checkIn,
		checkOut,
		nights,
		vatRateBps,
		themeStyle,
		onConfirm,
		onCancel
	}: {
		pending: { room: AvailableRoomType; plan: AvailableRatePlan; roomCount: number } | null;
		party: number;
		checkIn: string;
		checkOut: string;
		nights: number;
		vatRateBps: number;
		themeStyle: string;
		onConfirm: (p: { room: AvailableRoomType; plan: AvailableRatePlan; roomCount: number }) => void;
		onCancel: () => void;
	} = $props();

	const sfTheme = getContext<StorefrontTheme | undefined>('sf-theme');
	const peso = (centavos: number) =>
		`₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

	const perRoom = $derived(pending ? splitInteger(party, pending.roomCount) : []);
	const total = $derived(pending ? roomLinePrice(pending.plan, pending.roomCount, vatRateBps).totalCentavos : 0);
</script>

<Dialog.Root open={pending !== null} onOpenChange={(o) => !o && onCancel()}>
	<Dialog.Content
		style={themeStyle}
		data-mode={sfTheme?.mode ?? 'light'}
		showCloseButton={false}
		class="woven-ledger sf-split bg-[var(--ledger-paper)] text-[var(--ledger-ink)] ring-[var(--ledger-rule)]"
	>
		{#if pending}
			<div>
				<Dialog.Title class="sf-split-title">Your party of {party} needs {pending.roomCount} rooms</Dialog.Title>
				<Dialog.Description class="sf-split-sub">
					One room of {pending.room.name} sleeps {pending.room.maxOccupancy}, so you'll book {pending.roomCount} together on one booking.
				</Dialog.Description>
			</div>

			<ol class="sf-split-rooms">
				{#each perRoom as guests, i (i)}
					<li><span>Room {i + 1}</span><span class="ledger-data">{guests} guest{guests === 1 ? '' : 's'}</span></li>
				{/each}
			</ol>

			<dl class="sf-split-facts">
				<div><dt>Rate</dt><dd>{pending.plan.name}</dd></div>
				<div><dt>Stay</dt><dd>{formatStayDateShort(checkIn)} → {formatStayDateShort(checkOut)} · {nightsLabel(nights)}</dd></div>
				<div class="is-total"><dt>Total, {pending.roomCount} rooms</dt><dd class="ledger-data">{peso(total)}</dd></div>
			</dl>
			{#if pending.plan.securityDepositCentavos}
				<p class="sf-split-fine">
					Refundable security deposit {peso(pending.plan.securityDepositCentavos)} per room ({peso(pending.plan.securityDepositCentavos * pending.roomCount)} in all), collected at check-in.
				</p>
			{/if}

			<div class="sf-split-actions">
				<button type="button" class="sf-btn" onclick={() => onConfirm(pending!)}>Book {pending.roomCount} rooms</button>
				<button type="button" class="sf-link" onclick={onCancel}>Change guests</button>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
