<script lang="ts">
	import { getContext } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import AvailabilityRangePicker from '$lib/components/storefront/availability-range-picker.svelte';
	import type { CartStore } from '$lib/cart.svelte';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const cart = getContext<CartStore>('cart');

	let checkIn = $state(data.checkIn ?? '');
	let checkOut = $state(data.checkOut ?? '');
	let adults = $state(data.adults);
	let children = $state(data.children);
	let accessibleOnly = $state(data.accessibleOnly);
	let promo = $state(cart.promoCode ?? '');

	const clampAdults = (n: number) => Math.max(1, Math.min(10, n));
	const clampChildren = (n: number) => Math.max(0, Math.min(10, n));

	const nights = $derived(
		checkIn && checkOut ? Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000) : 0
	);
	const fmt = (iso: string) =>
		new Intl.DateTimeFormat('en-PH', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			timeZone: 'UTC'
		}).format(new Date(`${iso}T00:00:00Z`));
</script>

<svelte:head>
	<title>Check-in & check-out date — Book your stay</title>
</svelte:head>

<div>
	<h1 class="ledger-display text-2xl">Check-in &amp; check-out date</h1>
	<p class="mt-1 text-sm text-[var(--ledger-ink-muted)]">
		Pick your dates and party size — we'll show every room that's actually free.
	</p>

	<form method="GET" action="rooms" class="mt-6 space-y-6" onsubmit={() => cart.setPromoCode(promo)}>
		{#if data.roomTypeId}
			<input type="hidden" name="roomTypeId" value={data.roomTypeId} />
		{/if}

		<div class="dates-summary">
			<div>
				<div class="ledger-label">Check-in</div>
				<div class="ledger-data dates-summary-value" class:is-empty={!checkIn}>
					{checkIn ? fmt(checkIn) : 'Select a date'}
				</div>
			</div>
			<div>
				<div class="ledger-label">Check-out</div>
				<div class="ledger-data dates-summary-value" class:is-empty={!checkOut}>
					{checkOut ? fmt(checkOut) : 'Select a date'}
				</div>
			</div>
			<div>
				<div class="ledger-label">Number of nights</div>
				<div class="ledger-data dates-summary-value" class:is-empty={nights === 0}>
					{nights > 0 ? `${nights} night${nights === 1 ? '' : 's'}` : '—'}
				</div>
			</div>
			<div>
				<Label for="promo" class="ledger-label">Special code</Label>
				<Input
					id="promo"
					bind:value={promo}
					maxlength={40}
					placeholder="Optional"
					autocomplete="off"
					class="ledger-field mt-1"
				/>
			</div>
		</div>

		<AvailabilityRangePicker
			inline
			days={data.dayAvailability}
			today={data.today}
			bind:checkIn
			bind:checkOut
		/>

		<div class="dates-party">
			<div>
				<div class="ledger-label mb-1">Guests, per room</div>
				<div class="storefront-stepper-row">
					<span class="text-sm text-[var(--ledger-ink)]">Adults</span>
					<div class="storefront-stepper">
						<button
							type="button"
							aria-label="Fewer adults"
							onclick={() => (adults = clampAdults(adults - 1))}><MinusIcon /></button
						>
						<span class="ledger-data">{adults}</span>
						<button
							type="button"
							aria-label="More adults"
							onclick={() => (adults = clampAdults(adults + 1))}><PlusIcon /></button
						>
					</div>
				</div>
				<div class="storefront-stepper-row">
					<span class="text-sm text-[var(--ledger-ink)]">Children</span>
					<div class="storefront-stepper">
						<button
							type="button"
							aria-label="Fewer children"
							onclick={() => (children = clampChildren(children - 1))}><MinusIcon /></button
						>
						<span class="ledger-data">{children}</span>
						<button
							type="button"
							aria-label="More children"
							onclick={() => (children = clampChildren(children + 1))}><PlusIcon /></button
						>
					</div>
				</div>
				<input type="hidden" name="adults" value={adults} />
				<input type="hidden" name="children" value={children} />
			</div>

			<label class="storefront-checkbox-row self-end">
				<input type="checkbox" name="accessible" value="1" bind:checked={accessibleOnly} />
				Wheelchair-accessible rooms only
			</label>
		</div>

		<div class="dates-continue">
			<Button type="submit" class="ledger-btn-primary" disabled={nights === 0}>Continue</Button>
		</div>
	</form>
</div>

<style>
	.dates-summary {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem 1.5rem;
	}
	.dates-summary-value {
		margin-top: 0.25rem;
		padding-bottom: 0.375rem;
		font-size: 1rem;
		border-bottom: 1px solid var(--ledger-rule);
	}
	.dates-summary-value.is-empty {
		color: var(--ledger-ink-muted);
	}
	.dates-party {
		display: grid;
		gap: 1rem;
	}
	.dates-continue {
		display: flex;
		justify-content: flex-end;
	}

	@media (min-width: 720px) {
		.dates-summary {
			grid-template-columns: repeat(4, 1fr);
		}
		.dates-party {
			grid-template-columns: minmax(0, 20rem) 1fr;
		}
	}

	/* Phones: Continue stays reachable under a long calendar, above the support launcher. */
	@media (max-width: 719px) {
		.dates-continue {
			position: sticky;
			bottom: 0;
			z-index: 5;
			margin: 0 -1rem;
			padding: 0.75rem 1rem;
			background: var(--ledger-paper);
			border-top: 1px solid var(--ledger-rule);
		}
		.dates-continue :global(button) {
			width: 100%;
		}
	}
</style>
