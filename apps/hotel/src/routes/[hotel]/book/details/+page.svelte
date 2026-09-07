<script lang="ts">
	import { getContext } from 'svelte';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import type { CartStore } from '$lib/cart.svelte';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	const cart = getContext<CartStore>('cart');

	// Back to Rooms & Rates, pre-filled with the first room in the cart's own dates —
	// falls back to the homepage for a hall-only cart, since that's the only place a
	// hall reservation can be added.
	const firstRoomItem = $derived(cart.items.find((i) => i.kind === 'room'));
	const backHref = $derived(
		firstRoomItem
			? `/${page.params.hotel}/book/rooms?${new URLSearchParams({
					checkIn: firstRoomItem.checkIn,
					checkOut: firstRoomItem.checkOut
				}).toString()}`
			: `/${page.params.hotel}/book`
	);

	// The cart itself is the only source of truth for what's being booked — serialized into
	// this hidden field so the server can re-verify and re-price every line at submit time.
	const cartJson = $derived(
		JSON.stringify(
			cart.items.map((item) =>
				item.kind === 'room'
					? {
							kind: 'room',
							roomTypeId: item.roomTypeId,
							ratePlanId: item.ratePlanId,
							checkIn: item.checkIn,
							checkOut: item.checkOut,
							occupancy: item.occupancy,
							roomCount: item.roomCount
						}
					: {
							kind: 'hall',
							functionHallId: item.functionHallId,
							eventDate: item.eventDate,
							startTime: item.startTime,
							endTime: item.endTime,
							eventType: item.eventType,
							guestCount: item.guestCount
						}
			)
		)
	);
</script>

<div class="max-w-3xl">
	{#if cart.items.length > 0}
		<a href={backHref} class="storefront-step-back">
			← Back to {firstRoomItem ? 'rooms & rates' : 'homepage'}
		</a>
	{/if}
	<h1 class="mt-2 ledger-display text-2xl">Guest information</h1>

	{#if cart.items.length === 0}
		<p class="mt-4 text-sm text-[var(--ledger-ink-muted)]">
			Your invoice is empty. Go back and add a room or the function hall before continuing.
		</p>
		<Button href="/{page.params.hotel}/book" class="ledger-btn-primary mt-6">
			Back to {page.params.hotel}
		</Button>
	{:else}
		<!-- The itemized bill lives in the Booking Summary sidebar (mounted from +layout.svelte
		     for this step) — this page is just the guest-info form. -->
		<form
			method="POST"
			action="?/createOrder"
			use:enhance={() => {
				return async ({ result, update }) => {
					// A redirect means the order was created — the cart's job is done.
					if (result.type === 'redirect') cart.clear();
					await update();
				};
			}}
			class="mt-6 space-y-5"
		>
			<input type="hidden" name="cartJson" value={cartJson} />

			<div>
				<Label for="fullName" class="ledger-label">Full name</Label>
				<Input id="fullName" name="fullName" required class="ledger-field mt-1" />
			</div>
			<div class="grid grid-cols-1 gap-5 sm:grid-cols-2">
				<div>
					<Label for="email" class="ledger-label">Email</Label>
					<Input id="email" name="email" type="email" required class="ledger-field mt-1" />
				</div>
				<div>
					<Label for="phone" class="ledger-label">Phone</Label>
					<Input id="phone" name="phone" type="tel" class="ledger-field mt-1" />
				</div>
			</div>
			<div>
				<Label for="specialRequests" class="ledger-label">Special requests (optional)</Label>
				<!-- No shadcn Textarea is installed in this project; native element restyled with the same field tokens. -->
				<textarea id="specialRequests" name="specialRequests" rows="3" class="ledger-field mt-1"
				></textarea>
			</div>

			{#if form?.error}
				<p class="text-sm" style="color: var(--ledger-danger, #b91c1c);">{form.error}</p>
			{/if}

			<Button type="submit" class="ledger-btn-primary">Continue to review</Button>
		</form>
	{/if}
</div>
