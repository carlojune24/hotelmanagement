<script lang="ts">
	import { getContext } from 'svelte';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import LockIcon from '@lucide/svelte/icons/lock';
	import type { CartStore } from '$lib/cart.svelte';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	const cart = getContext<CartStore>('cart');

	let submitting = $state(false);

	// Back to Rooms & Rates, pre-filled with the first room in the cart's own dates —
	// falls back to the homepage for a hall-only cart, since that's the only place a
	// hall reservation can be added.
	const firstRoomItem = $derived(cart.items.find((i) => i.kind === 'room'));
	const backHref = $derived(
		firstRoomItem
			? `/${page.params.hotel}/rooms?${new URLSearchParams({
					checkIn: firstRoomItem.checkIn,
					checkOut: firstRoomItem.checkOut
				}).toString()}`
			: `/${page.params.hotel}`
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

<svelte:head>
	<title>Guest information — Book your stay</title>
</svelte:head>

<div class="max-w-3xl">
	{#if cart.items.length > 0}
		<a href={backHref} class="storefront-step-back">
			← Back to {firstRoomItem ? 'rooms & rates' : 'homepage'}
		</a>
	{/if}
	<h1 class="mt-2 ledger-display text-2xl">Guest information</h1>
	<p class="mt-1 text-sm text-[var(--ledger-ink-muted)]">
		Tell us who's staying. You'll check everything on the next page before paying.
	</p>

	{#if cart.items.length === 0}
		<div class="mt-8 rounded-md border border-[var(--ledger-rule)] px-5 py-6">
			<p class="ledger-display text-lg">Your invoice is empty</p>
			<p class="mt-1 text-sm text-[var(--ledger-ink-muted)]">
				Go back and add a room or the function hall before continuing.
			</p>
			<Button href="/{page.params.hotel}" class="ledger-btn-primary mt-4">
				Back to {page.params.hotel}
			</Button>
		</div>
	{:else}
		<!-- The itemized bill lives in the Booking Summary sidebar (mounted from +layout.svelte
		     for this step) — this page is just the guest-info form. -->
		<form
			method="POST"
			action="?/createOrder"
			use:enhance={() => {
				submitting = true;
				return async ({ result, update }) => {
					// A redirect means the order was created — the cart's job is done.
					if (result.type === 'redirect') cart.clear();
					await update();
					submitting = false;
				};
			}}
			class="mt-6 space-y-8"
		>
			<input type="hidden" name="cartJson" value={cartJson} />
			<input type="hidden" name="promoCode" value={cart.promoCode ?? ''} />

			<fieldset class="space-y-5">
				<legend class="ledger-label border-b border-[var(--ledger-rule)] pb-2 w-full">
					Who's staying
				</legend>

				<div>
					<Label for="fullName" class="ledger-label">Full name</Label>
					<Input
						id="fullName"
						name="fullName"
						required
						autocomplete="name"
						placeholder="As it appears on your ID"
						class="ledger-field mt-1"
					/>
				</div>
				<div class="grid grid-cols-1 gap-5 sm:grid-cols-2">
					<div>
						<Label for="email" class="ledger-label">Email</Label>
						<Input
							id="email"
							name="email"
							type="email"
							required
							autocomplete="email"
							inputmode="email"
							placeholder="you@example.com"
							class="ledger-field mt-1"
						/>
						<p class="mt-1 text-xs text-[var(--ledger-ink-muted)]">
							Your confirmation and receipt are sent here.
						</p>
					</div>
					<div>
						<Label for="phone" class="ledger-label">Mobile number (optional)</Label>
						<Input
							id="phone"
							name="phone"
							type="tel"
							autocomplete="tel"
							inputmode="tel"
							placeholder="+63 900 000 0000"
							class="ledger-field mt-1"
						/>
						<p class="mt-1 text-xs text-[var(--ledger-ink-muted)]">
							Only used if the hotel needs to reach you about your stay.
						</p>
					</div>
				</div>
			</fieldset>

			<fieldset class="space-y-3">
				<legend class="ledger-label border-b border-[var(--ledger-rule)] pb-2 w-full">
					Anything we should know?
				</legend>
				<div>
					<Label for="specialRequests" class="ledger-label">Special requests (optional)</Label>
					<!-- No shadcn Textarea is installed in this project; native element restyled with the same field tokens. -->
					<textarea
						id="specialRequests"
						name="specialRequests"
						rows="4"
						placeholder="Late arrival, a quiet floor, celebrating something special…"
						class="ledger-field mt-1"
					></textarea>
					<p class="mt-1 text-xs text-[var(--ledger-ink-muted)]">
						Requests are passed to the hotel and honored where possible — they aren't guaranteed.
					</p>
				</div>
			</fieldset>

			{#if form?.error}
				<p
					class="rounded-md border px-4 py-3 text-sm"
					style="color: var(--ledger-danger, #b91c1c); border-color: var(--ledger-danger, #b91c1c);"
					role="alert"
				>
					{form.error}
				</p>
			{/if}

			<div class="space-y-3">
				<Button
					type="submit"
					class="ledger-btn-primary min-h-12 w-full sm:w-auto"
					disabled={submitting}
				>
					{submitting ? 'Saving…' : 'Continue to review'}
				</Button>
				<p class="flex items-center gap-1.5 text-xs text-[var(--ledger-ink-muted)]">
					<LockIcon class="size-3.5" aria-hidden="true" />
					Nothing is charged on this step — you review the full bill first.
				</p>
			</div>
		</form>
	{/if}
</div>
